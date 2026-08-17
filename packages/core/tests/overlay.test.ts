import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JobDocument } from '../src/store/types.js';
import {
  allowedOverlayKeys,
  applyWorkflowOverlay,
  fingerprintFailure,
  mergeSelectors,
  tnpdclOverlayKeys,
  validateOverlayPatch,
} from '../src/overlay.ts';
import { ConfigError } from '../src/errors.ts';
import type { WorkflowStep } from '../src/workflow/types.js';

function workflowJob(overrides: Partial<JobDocument> = {}): JobDocument {
  return {
    id: 'price-job',
    userId: 'user-1',
    name: 'Price job',
    enabled: true,
    schedule: null,
    startUrl: 'https://example.test/',
    engine: 'workflow',
    goal: 'Read price',
    schema: [{ key: 'amount', label: 'Amount', type: 'price' }],
    workflow: [
      { id: 'goto-home', type: 'goto', url: 'https://example.test/' },
      {
        id: 'extract-amount',
        type: 'extract',
        fields: [{ key: 'amount', selector: '#old', strategy: 'text' }],
      },
    ],
    secretIds: [],
    notify: { title: 'Price', on: 'always', channel: { type: 'ntfy', topic: 'x' } },
    lastResult: null,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('allowedOverlayKeys', () => {
  it('returns adapter overlay keys for adapter jobs', () => {
    const keys = allowedOverlayKeys(
      workflowJob({ engine: 'adapter', adapterId: 'tnpdcl', workflow: [] }),
    );
    assert.deepEqual(keys, new Set(tnpdclOverlayKeys));
  });

  it('returns workflow field keys for workflow jobs', () => {
    const keys = allowedOverlayKeys(workflowJob());
    assert.ok(keys.has('field:amount'));
  });

  it('includes selector-bearing step keys', () => {
    const steps: WorkflowStep[] = [
      { id: 'fill-user', type: 'fill', selector: '#u', source: 'secret', secretKey: 'username' },
      { id: 'solve-cap', type: 'solve_captcha', imageSelector: '#img', inputSelector: '#in' },
      { id: 'click-go', type: 'click', selector: '#go' },
    ];
    const keys = allowedOverlayKeys(workflowJob({ workflow: steps, schema: [] }));
    assert.ok(keys.has('step:fill-user.selector'));
    assert.ok(keys.has('step:solve-cap.imageSelector'));
    assert.ok(keys.has('step:click-go.selector'));
  });
});

describe('applyWorkflowOverlay', () => {
  it('patches extract field selectors from field:<key> overlay entries', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'extract-amount',
        type: 'extract',
        fields: [{ key: 'amount', selector: '#old', strategy: 'text' }],
      },
    ];
    const patched = applyWorkflowOverlay(steps, { 'field:amount': '#new' });
    assert.equal(patched[0]?.type === 'extract' && patched[0].fields[0]?.selector, '#new');
  });

  it('patches step selectors from step:<id>.selector overlay entries', () => {
    const steps: WorkflowStep[] = [{ id: 'click-go', type: 'click', selector: '#old' }];
    const patched = applyWorkflowOverlay(steps, { 'step:click-go.selector': '#new' });
    assert.equal(patched[0]?.type === 'click' && patched[0].selector, '#new');
  });
});

describe('validateOverlayPatch', () => {
  it('rejects unknown keys for adapter patches', () => {
    assert.throws(
      () =>
        validateOverlayPatch({
          username: '#userName',
          unknown: '.foo',
        }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message.includes('unknown overlay key: unknown'),
    );
  });

  it('accepts workflow overlay keys when an allowlist is supplied', () => {
    const patch = validateOverlayPatch({ 'field:amount': '#new' }, ['field:amount']);
    assert.deepEqual(patch, { 'field:amount': '#new' });
  });
});

describe('mergeSelectors', () => {
  it('overrides known selectors with overlay values', () => {
    const merged = mergeSelectors(
      {
        username: '#username',
        password: '#password',
      },
      {
        username: '#userName',
      },
    );

    assert.deepEqual(merged, {
      username: '#userName',
      password: '#password',
    });
  });
});

describe('fingerprintFailure', () => {
  it('is stable for the same input', () => {
    const input = {
      code: 'LoginError',
      step: 'submit-login',
      urlPath: '/awp/login',
      title: 'TNPDCL Login',
    };
    const first = fingerprintFailure(input);
    const second = fingerprintFailure(input);
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });
});
