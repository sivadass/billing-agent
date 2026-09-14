import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trimLlmMessages, type LlmMessage } from '../src/trim.ts';

describe('trimLlmMessages', () => {
  it('keeps only the latest snapshot tree in the current user turn', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'You are a web automation agent.' },
      { role: 'user', content: 'Start URL: https://a.example\nGoal: x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '1', name: 'snapshot', arguments: '{}' }],
      },
      { role: 'tool', content: '{"tree":"OLD"}', toolCallId: '1', name: 'snapshot' },
      { role: 'user', content: 'keep going' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '2', name: 'snapshot', arguments: '{}' }],
      },
      { role: 'tool', content: '{"tree":"FIRST"}', toolCallId: '2', name: 'snapshot' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '3', name: 'snapshot', arguments: '{}' }],
      },
      { role: 'tool', content: '{"tree":"LATEST"}', toolCallId: '3', name: 'snapshot' },
    ];
    const trimmed = trimLlmMessages(messages);
    const snapshots = trimmed.filter((m) => m.role === 'tool' && m.name === 'snapshot');
    assert.equal(snapshots.length, 2);
    assert.deepEqual(JSON.parse(snapshots[0]!.content), { truncated: true, note: 'superseded' });
    assert.equal(snapshots[1]!.content, '{"tree":"LATEST"}');
    assert.equal(
      trimmed.some((m) => m.role === 'tool' && m.content.includes('OLD')),
      false,
    );
    assert.ok(trimmed.some((m) => m.role === 'user' && m.content === 'Start URL: https://a.example\nGoal: x'));
  });
});
