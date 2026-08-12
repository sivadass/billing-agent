import type { PriceSource } from '@billing-agent/core';

export type CompareInput = {
  previousPrice: number | null;
  previousCurrency: string | null;
  previousSource: PriceSource | null;
  currentPrice: number;
  currentCurrency: string;
  currentSource: PriceSource;
};

export type CompareResult =
  | { kind: 'baseline'; dropped: false }
  | { kind: 'reset'; dropped: false; reason: 'currency_changed' | 'source_changed' }
  | { kind: 'drop'; dropped: true; previousPrice: number }
  | { kind: 'unchanged_or_up'; dropped: false; previousPrice: number };

export function comparePrices(input: CompareInput): CompareResult {
  if (input.previousPrice === null) {
    return { kind: 'baseline', dropped: false };
  }
  if (
    input.previousCurrency !== null &&
    input.previousCurrency !== input.currentCurrency
  ) {
    return { kind: 'reset', dropped: false, reason: 'currency_changed' };
  }
  if (input.previousSource !== null && input.previousSource !== input.currentSource) {
    return { kind: 'reset', dropped: false, reason: 'source_changed' };
  }
  if (input.currentPrice < input.previousPrice) {
    return {
      kind: 'drop',
      dropped: true,
      previousPrice: input.previousPrice,
    };
  }
  return {
    kind: 'unchanged_or_up',
    dropped: false,
    previousPrice: input.previousPrice,
  };
}
