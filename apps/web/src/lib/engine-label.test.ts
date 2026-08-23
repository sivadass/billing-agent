import { describe, expect, it } from 'vitest';
import { engineLabel } from './engine-label';

describe('engineLabel', () => {
  it('labels an adapter engine with its adapter id', () => {
    expect(engineLabel({ engine: 'adapter', adapterId: 'tnpdcl' })).toBe('adapter:tnpdcl');
  });

  it('labels a workflow engine without an adapter id', () => {
    expect(engineLabel({ engine: 'workflow' })).toBe('workflow');
  });

  it('falls back to a plain adapter label when the adapter id is missing', () => {
    expect(engineLabel({ engine: 'adapter' })).toBe('adapter');
  });
});
