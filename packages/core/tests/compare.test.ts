import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExtractField } from '../src/store/types.ts';
import { decideNotify } from '../src/compare.ts';

const priceSchema: ExtractField[] = [
  { key: 'price', label: 'Price', type: 'price' },
  { key: 'currency', label: 'Currency', type: 'string' },
];

const billSchema: ExtractField[] = [
  { key: 'amount', label: 'Amount', type: 'price' },
  { key: 'dueDate', label: 'Due', type: 'date' },
];

describe('decideNotify', () => {
  it('always sends on success and failure', () => {
    assert.equal(
      decideNotify({
        on: 'always',
        status: 'success',
        result: { amount: '₹1' },
        lastResult: null,
        schema: billSchema,
      }),
      'send_success',
    );
    assert.equal(
      decideNotify({
        on: 'always',
        status: 'failed',
        result: null,
        lastResult: { amount: '₹1' },
        schema: billSchema,
      }),
      'send_failure',
    );
  });

  it('failure_only skips success and sends on failure', () => {
    assert.equal(
      decideNotify({
        on: 'failure_only',
        status: 'success',
        result: { amount: '₹1' },
        lastResult: null,
        schema: billSchema,
      }),
      'skip_success',
    );
    assert.equal(
      decideNotify({
        on: 'failure_only',
        status: 'failed',
        result: null,
        lastResult: null,
        schema: billSchema,
      }),
      'send_failure',
    );
  });

  it('change skips first success baseline and sends when schema values differ', () => {
    assert.equal(
      decideNotify({
        on: 'change',
        status: 'success',
        result: { amount: '₹100', dueDate: '2026-01-01' },
        lastResult: null,
        schema: billSchema,
      }),
      'skip_success',
    );
    assert.equal(
      decideNotify({
        on: 'change',
        status: 'success',
        result: { amount: '₹100', dueDate: '2026-01-01' },
        lastResult: { amount: '₹100', dueDate: '2026-01-01' },
        schema: billSchema,
      }),
      'skip_success',
    );
    assert.equal(
      decideNotify({
        on: 'change',
        status: 'success',
        result: { amount: '₹200', dueDate: '2026-01-01' },
        lastResult: { amount: '₹100', dueDate: '2026-01-01' },
        schema: billSchema,
      }),
      'send_success',
    );
    assert.equal(
      decideNotify({
        on: 'change',
        status: 'failed',
        result: null,
        lastResult: { amount: '₹100' },
        schema: billSchema,
      }),
      'send_failure',
    );
  });

  it('drop sends only when price falls with stable currency', () => {
    assert.equal(
      decideNotify({
        on: 'drop',
        status: 'success',
        result: { price: 100, currency: 'INR' },
        lastResult: null,
        schema: priceSchema,
      }),
      'skip_success',
    );
    assert.equal(
      decideNotify({
        on: 'drop',
        status: 'success',
        result: { price: 80, currency: 'INR' },
        lastResult: { price: 100, currency: 'INR' },
        schema: priceSchema,
      }),
      'send_success',
    );
    assert.equal(
      decideNotify({
        on: 'drop',
        status: 'success',
        result: { price: 120, currency: 'INR' },
        lastResult: { price: 100, currency: 'INR' },
        schema: priceSchema,
      }),
      'skip_success',
    );
    assert.equal(
      decideNotify({
        on: 'drop',
        status: 'success',
        result: { price: 80, currency: 'USD' },
        lastResult: { price: 100, currency: 'INR' },
        schema: priceSchema,
      }),
      'skip_success',
    );
  });

  it('drop skips when schema has no price field', () => {
    assert.equal(
      decideNotify({
        on: 'drop',
        status: 'success',
        result: { email: 'a@b.c' },
        lastResult: null,
        schema: [{ key: 'email', label: 'Email', type: 'string' }],
      }),
      'skip_success',
    );
  });

  it('drop skips non-positive current price', () => {
    assert.equal(
      decideNotify({
        on: 'drop',
        status: 'success',
        result: { price: 0, currency: 'INR' },
        lastResult: { price: 100, currency: 'INR' },
        schema: priceSchema,
      }),
      'skip_success',
    );
  });

  it('adapter notify false skips success regardless of on', () => {
    assert.equal(
      decideNotify({
        on: 'always',
        status: 'success',
        result: { amount: '₹1' },
        lastResult: null,
        schema: billSchema,
        adapterNotify: false,
      }),
      'skip_success',
    );
    assert.equal(
      decideNotify({
        on: 'always',
        status: 'failed',
        result: null,
        lastResult: null,
        schema: billSchema,
        adapterNotify: false,
      }),
      'send_failure',
    );
  });
});
