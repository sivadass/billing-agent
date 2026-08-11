import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comparePrices } from '../src/compare.ts';

describe('comparePrices', () => {
  it('returns baseline for first successful extract', () => {
    const result = comparePrices({
      previousPrice: null,
      previousCurrency: null,
      previousSource: null,
      currentPrice: 100,
      currentCurrency: 'INR',
      currentSource: 'shopify_json',
    });
    assert.deepEqual(result, { kind: 'baseline', dropped: false });
  });

  it('returns drop when currency/source match and price decreases', () => {
    const result = comparePrices({
      previousPrice: 120,
      previousCurrency: 'INR',
      previousSource: 'shopify_json',
      currentPrice: 99,
      currentCurrency: 'INR',
      currentSource: 'shopify_json',
    });
    assert.deepEqual(result, { kind: 'drop', dropped: true, previousPrice: 120 });
  });

  it('returns unchanged_or_up when price stays same or increases', () => {
    const result = comparePrices({
      previousPrice: 100,
      previousCurrency: 'INR',
      previousSource: 'shopify_json',
      currentPrice: 120,
      currentCurrency: 'INR',
      currentSource: 'shopify_json',
    });
    assert.deepEqual(result, { kind: 'unchanged_or_up', dropped: false, previousPrice: 100 });
  });

  it('resets baseline when currency changes', () => {
    const result = comparePrices({
      previousPrice: 100,
      previousCurrency: 'INR',
      previousSource: 'shopify_json',
      currentPrice: 80,
      currentCurrency: 'USD',
      currentSource: 'shopify_json',
    });
    assert.deepEqual(result, {
      kind: 'reset',
      dropped: false,
      reason: 'currency_changed',
    });
  });

  it('resets baseline when source changes', () => {
    const result = comparePrices({
      previousPrice: 100,
      previousCurrency: 'INR',
      previousSource: 'json_ld',
      currentPrice: 80,
      currentCurrency: 'INR',
      currentSource: 'selector',
    });
    assert.deepEqual(result, {
      kind: 'reset',
      dropped: false,
      reason: 'source_changed',
    });
  });
});
