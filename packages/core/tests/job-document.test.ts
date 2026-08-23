import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError } from '../src/errors.ts';
import { assertJobDocument } from '../src/store/assert-job.ts';
import type { JobDocument } from '../src/store/types.ts';

const newShapeFixture: JobDocument = {
  id: 'smoke-test',
  userId: 'user-1',
  name: 'Dummy Bill',
  enabled: true,
  schedule: null,
  startUrl: 'https://example.test/dummy',
  engine: 'adapter',
  adapterId: 'dummy',
  goal: '',
  schema: [],
  workflow: [],
  secretIds: [],
  notify: {
    title: 'Dummy Bill',
    on: 'always',
    channel: { type: 'ntfy', topic: 'billing' },
  },
  lastResult: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
};

/** The shape `migrateGenericJobs` writes for a former watch. */
const migratedWatchWorkflow = [
  { id: 'goto-watch', type: 'goto', url: 'https://craftandglory.in/products/sneakers' },
  {
    id: 'extract-price',
    type: 'extract',
    fields: [
      { key: 'price', strategy: 'shopify_json' },
      { key: 'currency', strategy: 'shopify_json' },
      { key: 'price', strategy: 'price' },
    ],
  },
];

function workflowJob(workflow: unknown): Record<string, unknown> {
  return {
    ...structuredClone(newShapeFixture),
    id: 'sivadass-in-email',
    engine: 'workflow',
    adapterId: undefined,
    startUrl: 'https://sivadass.in/',
    workflow,
  };
}

describe('assertJobDocument', () => {
  it('accepts a new-shape adapter job fixture', () => {
    const job = assertJobDocument(structuredClone(newShapeFixture));
    assert.deepEqual(job, newShapeFixture);
  });

  it('keeps accepting an adapter job with an empty workflow', () => {
    const job = assertJobDocument({
      ...structuredClone(newShapeFixture),
      workflow: [],
    });
    assert.deepEqual(job.workflow, []);
  });

  it('accepts the workflow a migrated watch produces, same-key cascade included', () => {
    const job = assertJobDocument(workflowJob(structuredClone(migratedWatchWorkflow)));
    assert.deepEqual(job.workflow, migratedWatchWorkflow);
  });

  it('accepts the documented sivadass.in workflow', () => {
    const job = assertJobDocument(
      workflowJob([
        { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
        {
          id: 'extract-email',
          type: 'extract',
          fields: [
            { key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' },
          ],
        },
      ]),
    );
    assert.equal(job.workflow.length, 2);
  });

  // Write-time validation must reject exactly what the interpreter refuses to
  // run, so a job can never be saved that fails on its first scheduled tick.
  it('rejects the malformed steps the interpreter rejects', () => {
    const extract = {
      id: 'extract-email',
      type: 'extract',
      fields: [{ key: 'email', selector: 'a', strategy: 'text' }],
    };
    const malformed: Array<[string, unknown]> = [
      ['goto protocol', [{ id: 'g', type: 'goto', url: 'javascript:alert(1)' }, extract]],
      ['goto private host', [{ id: 'g', type: 'goto', url: 'http://127.0.0.1/' }, extract]],
      ['goto not a url', [{ id: 'g', type: 'goto', url: 'sivadass.in' }, extract]],
      ['goto file authority', [{ id: 'g', type: 'goto', url: 'file://evil.example/x' }, extract]],
      [
        'fill secret without secretKey',
        [{ id: 'f', type: 'fill', selector: '#p', source: 'secret' }, extract],
      ],
      [
        'fill literal without value',
        [{ id: 'f', type: 'fill', selector: '#p', source: 'literal' }, extract],
      ],
      [
        'fill with both value and secretKey',
        [
          {
            id: 'f',
            type: 'fill',
            selector: '#p',
            source: 'secret',
            secretKey: 'password',
            value: 'nope',
          },
          extract,
        ],
      ],
      ['wait with no selector or timeout', [{ id: 'w', type: 'wait' }, extract]],
      ['wait timeout zero', [{ id: 'w', type: 'wait', timeoutMs: 0 }, extract]],
      ['wait timeout out of bounds', [{ id: 'w', type: 'wait', timeoutMs: 10_000_000 }, extract]],
      ['empty extract fields', [{ id: 'e', type: 'extract', fields: [] }]],
      ['extract without fields', [{ id: 'e', type: 'extract' }]],
      [
        'text strategy without selector',
        [{ id: 'e', type: 'extract', fields: [{ key: 'email', strategy: 'text' }] }],
      ],
      [
        'field without a strategy or selector',
        [{ id: 'e', type: 'extract', fields: [{ key: 'email' }] }],
      ],
      [
        'duplicate step ids',
        [
          { id: 'same', type: 'goto', url: 'https://sivadass.in/' },
          { ...extract, id: 'same' },
        ],
      ],
      ['unknown step type', [{ id: 's', type: 'teleport' }, extract]],
      [
        'unknown step property',
        [{ id: 's', type: 'click', selector: '#a', script: 'alert(1)' }, extract],
      ],
      ['assert without exists', [{ id: 'a', type: 'assert', selector: '#a' }, extract]],
    ];

    for (const [label, workflow] of malformed) {
      assert.throws(() => assertJobDocument(workflowJob(workflow)), ConfigError, label);
    }
  });

  it('requires a workflow job to carry a replayable extract step', () => {
    assert.throws(() => assertJobDocument(workflowJob([])), ConfigError);
    assert.throws(
      () =>
        assertJobDocument(
          workflowJob([{ id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' }]),
        ),
      ConfigError,
    );
  });
});
