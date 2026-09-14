import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAuthoringRunMap } from '../src/runs.ts';

describe('authoring run map', () => {
  it('tracks a single in-flight invoke and rejects a second begin', () => {
    const runs = createAuthoringRunMap();
    const signal = runs.begin('conv-1');
    assert.equal(signal.aborted, false);
    assert.equal(runs.isRunning('conv-1'), true);
    assert.throws(() => runs.begin('conv-1'), /Authoring already running/);
    runs.end('conv-1');
    assert.equal(runs.isRunning('conv-1'), false);
  });

  it('abort marks the signal aborted and clears running', () => {
    const runs = createAuthoringRunMap();
    const signal = runs.begin('conv-1');
    runs.abort('conv-1');
    assert.equal(signal.aborted, true);
    assert.equal(runs.isRunning('conv-1'), false);
  });
});
