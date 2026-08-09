import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractCompactDom,
  proposeOverlayPatch,
} from '../src/recovery.ts';
import { ConfigError } from '../src/errors.ts';

describe('extractCompactDom', () => {
  it('returns a compact and truncated DOM snapshot', async () => {
    const page = {
      evaluate: async () => 'x'.repeat(20_000),
    };
    const compact = await extractCompactDom(page as never);
    assert.equal(compact.length, 12_000);
  });
});

describe('proposeOverlayPatch', () => {
  it('returns validated overlay patch from model JSON', async () => {
    const overlay = await proposeOverlayPatch(
      {
        errorMessage: 'login failed',
        compactDom: '<input id="userName" />',
        allowedKeys: ['username'],
      },
      {
        completeJson: async () => JSON.stringify({ username: '#userName' }),
      },
    );
    assert.deepEqual(overlay, { username: '#userName' });
  });

  it('throws ConfigError on invalid JSON payloads', async () => {
    await assert.rejects(
      () =>
        proposeOverlayPatch(
          {
            errorMessage: 'login failed',
            compactDom: '<input id="userName" />',
            allowedKeys: ['username'],
          },
          {
            completeJson: async () => 'not-json',
          },
        ),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message.includes('Recovery response must be valid JSON'),
    );
  });
});
