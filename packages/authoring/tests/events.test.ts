import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConversationEventBus } from '../src/events.ts';

describe('conversation event bus', () => {
  it('delivers only to the matching conversation id', () => {
    const bus = createConversationEventBus();
    const seen: string[] = [];
    bus.subscribe('conv-1', (event) => {
      if (event.type === 'tool') seen.push(event.tool);
    });
    bus.publish('conv-2', {
      type: 'tool',
      tool: 'click',
      conversationId: 'conv-2',
      at: '2026-09-14T00:00:00.000Z',
    });
    bus.publish('conv-1', {
      type: 'tool',
      tool: 'snapshot',
      conversationId: 'conv-1',
      at: '2026-09-14T00:00:00.000Z',
    });
    assert.deepEqual(seen, ['snapshot']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = createConversationEventBus();
    let count = 0;
    const stop = bus.subscribe('conv-1', () => {
      count += 1;
    });
    stop();
    bus.publish('conv-1', {
      type: 'turn_end',
      conversationId: 'conv-1',
      at: '2026-09-14T00:00:00.000Z',
    });
    assert.equal(count, 0);
  });
});
