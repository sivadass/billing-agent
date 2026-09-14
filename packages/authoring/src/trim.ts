export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

const SUPERSEDED_SNAPSHOT = JSON.stringify({ truncated: true, note: 'superseded' });

function lastUserIndex(messages: LlmMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

export function trimLlmMessages(messages: LlmMessage[]): LlmMessage[] {
  const lastUser = lastUserIndex(messages);
  const result: LlmMessage[] = [];
  let lastSnapshotIndexInTurn = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;

    if (message.role === 'system') {
      if (result.some((entry) => entry.role === 'system')) continue;
      result.push(message);
      continue;
    }

    if (message.role === 'user' || message.role === 'assistant') {
      if (message.role === 'assistant' && message.toolCalls?.length) {
        if (index > lastUser) {
          result.push(message);
        }
        continue;
      }
      result.push(message);
      continue;
    }

    if (message.role === 'tool') {
      if (index <= lastUser) continue;
      if (message.name === 'snapshot') {
        if (lastSnapshotIndexInTurn >= 0) {
          const previous = result[lastSnapshotIndexInTurn];
          if (previous?.role === 'tool') {
            result[lastSnapshotIndexInTurn] = {
              ...previous,
              content: SUPERSEDED_SNAPSHOT,
            };
          }
        }
        result.push(message);
        lastSnapshotIndexInTurn = result.length - 1;
      } else {
        result.push(message);
      }
    }
  }

  return result;
}
