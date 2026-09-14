import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from './api-client';
import { subscribeConversationEvents } from './conversations-api';

describe('subscribeConversationEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses tool events and ignores heartbeats', async () => {
    const onEvent = vi.fn();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: tool\ndata: {"type":"tool","tool":"click","conversationId":"c","at":"t"}\n\n',
          ),
        );
        controller.enqueue(encoder.encode(': ping\n\n'));
        controller.close();
      },
    });

    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const abort = new AbortController();
    await subscribeConversationEvents('c', onEvent, abort.signal);

    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool',
      tool: 'click',
      conversationId: 'c',
      at: 't',
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
