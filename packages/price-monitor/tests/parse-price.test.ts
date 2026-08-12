import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePriceString } from '../src/parse-price.ts';

describe('parsePriceString', () => {
  it('parses rupee prefixes and commas', () => {
    assert.equal(parsePriceString('Rs. 8,450.00'), 8450);
    assert.equal(parsePriceString('₹7,605'), 7605);
  });

  it('parses plain numeric strings', () => {
    assert.equal(parsePriceString('8450'), 8450);
  });

  it('parses number with trailing currency token', () => {
    assert.equal(parsePriceString('8,450.00 INR'), 8450);
  });

  it('returns null when no numeric price can be derived', () => {
    assert.equal(parsePriceString('price unavailable'), null);
  });
});
