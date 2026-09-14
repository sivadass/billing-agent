import type { AuthoringCheckpointPort } from './runtime.js';

export function createMongoCheckpointPort(saver: {
  getTuple(config: { configurable: { thread_id: string } }): Promise<unknown>;
  deleteThread(threadId: string): Promise<void>;
}): AuthoringCheckpointPort {
  return {
    async has(conversationId) {
      const tuple = await saver.getTuple({
        configurable: { thread_id: conversationId },
      });
      return Boolean(tuple);
    },
    async delete(conversationId) {
      await saver.deleteThread(conversationId);
    },
  };
}
