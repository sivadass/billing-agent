export function createAuthoringRunMap() {
  const controllers = new Map<string, AbortController>();
  return {
    isRunning(conversationId: string) {
      return controllers.has(conversationId);
    },
    begin(conversationId: string) {
      if (controllers.has(conversationId)) {
        throw new Error('Authoring already running');
      }
      const controller = new AbortController();
      controllers.set(conversationId, controller);
      return controller.signal;
    },
    end(conversationId: string) {
      controllers.delete(conversationId);
    },
    abort(conversationId: string) {
      controllers.get(conversationId)?.abort();
      controllers.delete(conversationId);
    },
  };
}
