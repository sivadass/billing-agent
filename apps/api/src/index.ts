export type ApiServerHandle = {
  close(): Promise<void>;
};

/**
 * API implementation is introduced in Task 7. The worker can import this
 * symbol now without wiring routes yet.
 */
export async function startServer(): Promise<ApiServerHandle> {
  return {
    async close() {
      // no-op placeholder
    },
  };
}
