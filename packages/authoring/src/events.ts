export const CONVERSATION_TOOLS = [
  'snapshot',
  'click',
  'fill',
  'wait',
  'extract_candidates',
] as const;
export type ConversationToolName = (typeof CONVERSATION_TOOLS)[number];

export type ConversationStreamEvent =
  | {
      type: 'tool';
      tool: ConversationToolName;
      conversationId: string;
      at: string;
    }
  | {
      type: 'interrupt';
      kind: 'secret' | 'confirm';
      conversationId: string;
      at: string;
    }
  | { type: 'turn_end'; conversationId: string; at: string };

export function createConversationEventBus(): {
  publish(conversationId: string, event: ConversationStreamEvent): void;
  subscribe(
    conversationId: string,
    listener: (event: ConversationStreamEvent) => void,
  ): () => void;
} {
  const listeners = new Map<string, Set<(event: ConversationStreamEvent) => void>>();

  return {
    publish(conversationId, event) {
      const conversationListeners = listeners.get(conversationId);
      if (!conversationListeners) return;
      for (const listener of conversationListeners) {
        listener(event);
      }
    },
    subscribe(conversationId, listener) {
      let conversationListeners = listeners.get(conversationId);
      if (!conversationListeners) {
        conversationListeners = new Set();
        listeners.set(conversationId, conversationListeners);
      }
      conversationListeners.add(listener);
      return () => {
        conversationListeners?.delete(listener);
        if (conversationListeners?.size === 0) {
          listeners.delete(conversationId);
        }
      };
    },
  };
}
