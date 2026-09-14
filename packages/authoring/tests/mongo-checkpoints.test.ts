import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMongoCheckpointPort } from '../src/mongo-checkpoints.ts';

describe('createMongoCheckpointPort', () => {
  it('has() is true only when getTuple returns a value', async () => {
    const tuples = new Map<string, object>([['conv-1', { id: 'ckpt' }]]);
    const port = createMongoCheckpointPort({
      saver: {
        async getTuple(config) {
          return tuples.get(config.configurable.thread_id) ?? null;
        },
      },
      async deleteThread(threadId) {
        tuples.delete(threadId);
      },
    });
    assert.equal(await port.has('conv-1'), true);
    assert.equal(await port.has('conv-2'), false);
    await port.delete('conv-1');
    assert.equal(await port.has('conv-1'), false);
  });
});
