import type {
  PriceCheckDocument,
  PriceSource,
  WatchDocument
} from '@billing-agent/core';

export type ExtractedPrice = {
  price: number;
  currency: string;
  title?: string;
  source: PriceSource;
};

export type { PriceCheckDocument, PriceSource, WatchDocument };
