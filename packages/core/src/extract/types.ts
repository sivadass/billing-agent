import type { PriceSource } from '../store/types.js';

/** One successful price read, tagged with the extractor that produced it. */
export type ExtractedPrice = {
  price: number;
  currency: string;
  title?: string;
  source: PriceSource;
};
