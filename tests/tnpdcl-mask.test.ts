import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskAccount } from '../src/adapters/tnpdcl.ts';
import {
  getAdapter,
  registerBuiltInAdapters,
} from '../src/adapters/registry.ts';
import { tnpdclAdapter } from '../src/adapters/tnpdcl.ts';

describe('maskAccount', () => {
  it('masks all but the last 4 digits', () => {
    assert.equal(maskAccount('1234567890'), '****7890');
  });

  it('trims whitespace before masking', () => {
    assert.equal(maskAccount('  1234567890  '), '****7890');
  });

  it('handles ids shorter than 4 characters', () => {
    assert.equal(maskAccount('12'), '****12');
  });
});

describe('adapter registry (tnpdcl)', () => {
  it('registers the tnpdcl adapter', () => {
    registerBuiltInAdapters();
    assert.equal(getAdapter('tnpdcl'), tnpdclAdapter);
    assert.equal(tnpdclAdapter.id, 'tnpdcl');
  });
});
