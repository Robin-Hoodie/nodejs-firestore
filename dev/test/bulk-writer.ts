// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {expect} from 'chai';
import {Status} from 'google-gax';

import * as proto from '../protos/firestore_v1_proto_api';
import {Firestore, setLogFunction, Timestamp, WriteResult} from '../src';
import {BulkWriter} from '../src/bulk-writer';
import {Deferred} from '../src/util';
import {
  ApiOverride,
  create,
  createInstance,
  document,
  remove,
  response,
  set,
  update,
  updateMask,
  verifyInstance,
} from './util/helpers';

import api = proto.google.firestore.v1;

// Change the argument to 'console.log' to enable debug output.
setLogFunction(() => {});

const PROJECT_ID = 'test-project';

interface BulkWriterRequest {
  writes: api.IWrite[] | null;
}

interface BulkWriterResponse {
  writeResults: api.IWriteResult[] | null;
  status: proto.google.rpc.IStatus[] | null;
}

interface RequestResponse {
  request: BulkWriterRequest;
  response: BulkWriterResponse;
}

describe('BulkWriter', () => {
  let firestore: Firestore;
  let requestCounter: number;
  let opCount: number;
  const activeRequestDeferred = new Deferred<void>();
  let activeRequestCounter = 0;

  beforeEach(() => {
    requestCounter = 0;
    opCount = 0;
  });

  function incrementOpCount(): void {
    opCount++;
  }

  function verifyOpCount(expected: number): void {
    expect(opCount).to.equal(expected);
  }

  function setOp(doc: string, value: string): api.IWrite {
    return set({
      document: document(doc, 'foo', value),
    }).writes![0];
  }

  function updateOp(doc: string, value: string): api.IWrite {
    return update({
      document: document(doc, 'foo', value),
      mask: updateMask('foo'),
    }).writes![0];
  }

  function createOp(doc: string, value: string): api.IWrite {
    return create({
      document: document(doc, 'foo', value),
    }).writes![0];
  }

  function deleteOp(doc: string): api.IWrite {
    return remove(doc).writes![0];
  }

  function createRequest(requests: api.IWrite[]): BulkWriterRequest {
    return {
      writes: requests,
    };
  }

  function successResponse(seconds: number): {[key: string]: {}} {
    return {
      updateTime: {
        nanos: 0,
        seconds,
      },
      code: Status.OK,
    };
  }

  function failResponse(): {[key: string]: {} | null} {
    return {
      updateTime: null,
      code: Status.UNAVAILABLE,
    };
  }

  function createResponse(
    responses: Array<{[key: string]: {} | null}>
  ): BulkWriterResponse {
    const writeResults = responses.map(response => ({
      updateTime: response.updateTime,
    }));
    const status = responses.map(
      response => ({code: response.code!} as proto.google.rpc.IStatus)
    );
    return {
      writeResults,
      status,
    };
  }

  /**
   * Creates an instance with the mocked objects.
   *
   * @param checkActiveRequests Whether to check for active requests. If true,
   * the `activeRequestDeferred` must be manually resolved for the response to
   * return.
   */
  function instantiateInstance(
    mock: RequestResponse[],
    checkActiveRequests = false
  ): Promise<BulkWriter> {
    const overrides: ApiOverride = {
      batchWrite: async request => {
        expect(request).to.deep.eq({
          database: `projects/${PROJECT_ID}/databases/(default)`,
          writes: mock[requestCounter].request.writes,
        });
        if (checkActiveRequests) {
          activeRequestCounter++;

          // This expect statement is used to test that only one request is
          // made at a time.
          expect(activeRequestCounter).to.equal(1);
          await activeRequestDeferred.promise;
          activeRequestCounter--;
        }
        const responsePromise = response({
          writeResults: mock[requestCounter].response.writeResults,
          status: mock[requestCounter].response.status,
        });
        requestCounter++;
        return responsePromise;
      },
    };
    return createInstance(overrides).then(firestoreClient => {
      firestore = firestoreClient;
      return firestore.bulkWriter();
    });
  }

  afterEach(() => verifyInstance(firestore));

  it('has a set() method', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([setOp('doc', 'bar')]),
        response: createResponse([successResponse(2)]),
      },
    ]);
    const doc = firestore.doc('collectionId/doc');
    let writeResult: WriteResult;
    bulkWriter.set(doc, {foo: 'bar'}).then(result => {
      incrementOpCount();
      writeResult = result;
    });
    return bulkWriter.close().then(async () => {
      verifyOpCount(1);
      expect(writeResult.writeTime.isEqual(new Timestamp(2, 0))).to.be.true;
    });
  });

  it('has an update() method', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([updateOp('doc', 'bar')]),
        response: createResponse([successResponse(2)]),
      },
    ]);
    const doc = firestore.doc('collectionId/doc');
    let writeResult: WriteResult;
    bulkWriter.update(doc, {foo: 'bar'}).then(result => {
      incrementOpCount();
      writeResult = result;
    });
    return bulkWriter.close().then(async () => {
      verifyOpCount(1);
      expect(writeResult.writeTime.isEqual(new Timestamp(2, 0))).to.be.true;
    });
  });

  it('has a delete() method', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([deleteOp('doc')]),
        response: createResponse([successResponse(2)]),
      },
    ]);
    const doc = firestore.doc('collectionId/doc');
    let writeResult: WriteResult;
    bulkWriter.delete(doc).then(result => {
      incrementOpCount();
      writeResult = result;
    });
    return bulkWriter.close().then(async () => {
      verifyOpCount(1);
      expect(writeResult.writeTime.isEqual(new Timestamp(2, 0))).to.be.true;
    });
  });

  it('has a create() method', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([createOp('doc', 'bar')]),
        response: createResponse([successResponse(2)]),
      },
    ]);
    const doc = firestore.doc('collectionId/doc');
    let writeResult: WriteResult;
    bulkWriter.create(doc, {foo: 'bar'}).then(result => {
      incrementOpCount();
      writeResult = result;
    });
    return bulkWriter.close().then(async () => {
      verifyOpCount(1);
      expect(writeResult.writeTime.isEqual(new Timestamp(2, 0))).to.be.true;
    });
  });

  it('surfaces errors', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([setOp('doc', 'bar')]),
        response: createResponse([failResponse()]),
      },
    ]);

    const doc = firestore.doc('collectionId/doc');
    bulkWriter.set(doc, {foo: 'bar'}).catch(err => {
      incrementOpCount();
      expect(err.code).to.equal(Status.UNAVAILABLE);
    });

    return bulkWriter.close().then(async () => verifyOpCount(1));
  });

  it('flush() resolves immediately if there are no writes', async () => {
    const bulkWriter = await instantiateInstance([]);
    return bulkWriter.flush().then(() => verifyOpCount(0));
  });

  it('adds writes to a new batch after calling flush()', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([createOp('doc', 'bar')]),
        response: createResponse([successResponse(2)]),
      },
      {
        request: createRequest([setOp('doc2', 'bar1')]),
        response: createResponse([successResponse(2)]),
      },
    ]);
    bulkWriter
      .create(firestore.doc('collectionId/doc'), {foo: 'bar'})
      .then(incrementOpCount);
    bulkWriter.flush();
    bulkWriter
      .set(firestore.doc('collectionId/doc2'), {foo: 'bar1'})
      .then(incrementOpCount);
    await bulkWriter.close().then(async () => {
      verifyOpCount(2);
    });
  });

  it('close() sends all writes', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([createOp('doc', 'bar')]),
        response: createResponse([successResponse(2)]),
      },
    ]);
    const doc = firestore.doc('collectionId/doc');
    bulkWriter.create(doc, {foo: 'bar'}).then(incrementOpCount);
    return bulkWriter.close().then(async () => {
      verifyOpCount(1);
    });
  });

  it('close() resolves immediately if there are no writes', async () => {
    const bulkWriter = await instantiateInstance([]);
    return bulkWriter.close().then(() => verifyOpCount(0));
  });

  it('cannot call methods after close() is called', async () => {
    const bulkWriter = await instantiateInstance([]);

    const expected = 'BulkWriter has already been closed.';
    const doc = firestore.doc('collectionId/doc');
    await bulkWriter.close();
    expect(() => bulkWriter.set(doc, {})).to.throw(expected);
    expect(() => bulkWriter.create(doc, {})).to.throw(expected);
    expect(() => bulkWriter.update(doc, {})).to.throw(expected);
    expect(() => bulkWriter.delete(doc)).to.throw(expected);
    expect(bulkWriter.flush()).to.eventually.be.rejectedWith(expected);
    expect(bulkWriter.close()).to.eventually.be.rejectedWith(expected);
  });

  it('sends writes to the same document in separate batches', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([setOp('doc', 'bar')]),
        response: createResponse([successResponse(0)]),
      },
      {
        request: createRequest([updateOp('doc', 'bar1')]),
        response: createResponse([successResponse(1)]),
      },
    ]);

    // Create two document references pointing to the same document.
    const doc = firestore.doc('collectionId/doc');
    const doc2 = firestore.doc('collectionId/doc');
    bulkWriter.set(doc, {foo: 'bar'}).then(incrementOpCount);
    bulkWriter.update(doc2, {foo: 'bar1'}).then(incrementOpCount);

    return bulkWriter.close().then(async () => {
      verifyOpCount(2);
    });
  });

  it('sends writes to different documents in the same batch', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([setOp('doc1', 'bar'), updateOp('doc2', 'bar')]),
        response: createResponse([successResponse(0), successResponse(1)]),
      },
    ]);

    const doc1 = firestore.doc('collectionId/doc1');
    const doc2 = firestore.doc('collectionId/doc2');
    bulkWriter.set(doc1, {foo: 'bar'}).then(incrementOpCount);
    bulkWriter.update(doc2, {foo: 'bar'}).then(incrementOpCount);

    return bulkWriter.close().then(async () => {
      verifyOpCount(2);
    });
  });

  it('splits into multiple batches after exceeding maximum batch size', async () => {
    const arrayRange = Array.from(new Array(6), (_, i) => i);
    const requests = arrayRange.map(i => setOp('doc' + i, 'bar'));
    const responses = arrayRange.map(i => successResponse(i));
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([requests[0], requests[1]]),
        response: createResponse([responses[0], responses[1]]),
      },
      {
        request: createRequest([requests[2], requests[3]]),
        response: createResponse([responses[2], responses[3]]),
      },
      {
        request: createRequest([requests[4], requests[5]]),
        response: createResponse([responses[4], responses[5]]),
      },
    ]);

    bulkWriter._setMaxBatchSize(2);
    for (let i = 0; i < 6; i++) {
      bulkWriter
        .set(firestore.doc('collectionId/doc' + i), {foo: 'bar'})
        .then(incrementOpCount);
    }

    return bulkWriter.close().then(async () => {
      verifyOpCount(6);
    });
  });

  it('sends existing batches when a new batch is created', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([setOp('doc', 'bar')]),
        response: createResponse([successResponse(0)]),
      },
      {
        request: createRequest([
          updateOp('doc', 'bar1'),
          createOp('doc2', 'bar1'),
        ]),
        response: createResponse([successResponse(1), successResponse(2)]),
      },
    ]);

    bulkWriter._setMaxBatchSize(2);

    const doc = firestore.doc('collectionId/doc');
    const doc2 = firestore.doc('collectionId/doc2');

    // Create a new batch by writing to the same document.
    const setPromise = bulkWriter.set(doc, {foo: 'bar'}).then(incrementOpCount);
    const updatePromise = bulkWriter
      .update(doc, {foo: 'bar1'})
      .then(incrementOpCount);
    await setPromise;

    // Create a new batch by reaching the batch size limit.
    const createPromise = bulkWriter
      .create(doc2, {foo: 'bar1'})
      .then(incrementOpCount);

    await updatePromise;
    await createPromise;
    verifyOpCount(3);
    return bulkWriter.close();
  });

  it('sends batches automatically when the batch size limit is reached', async () => {
    const bulkWriter = await instantiateInstance([
      {
        request: createRequest([
          setOp('doc1', 'bar'),
          updateOp('doc2', 'bar'),
          createOp('doc3', 'bar'),
        ]),
        response: createResponse([
          successResponse(0),
          successResponse(1),
          successResponse(2),
        ]),
      },
      {
        request: createRequest([deleteOp('doc4')]),
        response: createResponse([successResponse(3)]),
      },
    ]);

    bulkWriter._setMaxBatchSize(3);
    const promise1 = bulkWriter
      .set(firestore.doc('collectionId/doc1'), {foo: 'bar'})
      .then(incrementOpCount);
    const promise2 = bulkWriter
      .update(firestore.doc('collectionId/doc2'), {foo: 'bar'})
      .then(incrementOpCount);
    const promise3 = bulkWriter
      .create(firestore.doc('collectionId/doc3'), {foo: 'bar'})
      .then(incrementOpCount);

    // The 4th write should not sent because it should be in a new batch.
    bulkWriter
      .delete(firestore.doc('collectionId/doc4'))
      .then(incrementOpCount);

    await Promise.all([promise1, promise2, promise3]).then(() => {
      verifyOpCount(3);
    });

    return bulkWriter.close().then(async () => {
      verifyOpCount(4);
    });
  });

  it('does not send batches if a document containing the same write is in flight', async () => {
    const bulkWriter = await instantiateInstance(
      [
        {
          request: createRequest([setOp('doc1', 'bar'), setOp('doc2', 'bar')]),
          response: createResponse([successResponse(1), successResponse(2)]),
        },
        {
          request: createRequest([setOp('doc1', 'bar')]),
          response: createResponse([successResponse(3)]),
        },
      ],
      /** manualFlush= */ true
    );
    bulkWriter.set(firestore.doc('collectionId/doc1'), {foo: 'bar'});
    bulkWriter.set(firestore.doc('collectionId/doc2'), {foo: 'bar'});
    const flush1 = bulkWriter.flush();
    // The third write will be placed in a new batch
    bulkWriter.set(firestore.doc('collectionId/doc1'), {foo: 'bar'});
    const flush2 = bulkWriter.flush();
    activeRequestDeferred.resolve();
    await flush1;
    await flush2;
    return bulkWriter.close();
  });
});