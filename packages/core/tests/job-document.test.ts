import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

describe('assertJobDocument', () => {
  it('accepts a new-shape adapter job fixture', () => {
    const job = assertJobDocument(structuredClone(newShapeFixture));
    assert.deepEqual(job, newShapeFixture);
  });
});
