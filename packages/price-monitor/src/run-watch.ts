import { randomUUID } from 'node:crypto';
import type {
  BillingStore,
  PriceCheckDocument,
  WatchDocument,
  sendNtfy as sendNtfyFn,
} from '@billing-agent/core';
import { comparePrices } from './compare.js';
import { extractPrice as defaultExtractPrice } from './extract.js';
import { formatDropNotification } from './notify-drop.js';
import { isWatchLocked, releaseWatchLock, tryAcquireWatchLock } from './watch-lock.js';

export class WatchBusyError extends Error {
  constructor(watchId: string) {
    super(`Watch already running: ${watchId}`);
    this.name = 'WatchBusyError';
  }
}

type RunWatchInput = {
  watch: WatchDocument;
  store: BillingStore;
  extractPrice?: typeof defaultExtractPrice;
  sendNtfy: typeof sendNtfyFn;
  ntfy: { baseUrl: string; topic: string; priority: string };
  browserLoadHtml: (url: string) => Promise<string>;
  mistralApiKey?: string;
  mistralModel?: string;
  checkId?: string;
  onCheckCreated?: (checkId: string) => void;
};

function runningCheck(watch: WatchDocument, checkId: string, checkedAt: string): PriceCheckDocument {
  return {
    id: checkId,
    watchId: watch.id,
    userId: watch.userId,
    status: 'running',
    price: null,
    currency: null,
    source: null,
    previousPrice: watch.lastPrice,
    dropped: null,
    error: null,
    checkedAt,
  };
}

export async function runWatch(input: RunWatchInput): Promise<PriceCheckDocument> {
  if (!tryAcquireWatchLock(input.watch.id)) {
    throw new WatchBusyError(input.watch.id);
  }

  const extractPrice = input.extractPrice ?? defaultExtractPrice;
  const checkId = input.checkId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const running = runningCheck(input.watch, checkId, startedAt);

  try {
    if (!input.checkId) {
      await input.store.createPriceCheck(running);
    }
    input.onCheckCreated?.(checkId);

    const extracted = await extractPrice({
      url: input.watch.url,
      loadPageHtml: input.browserLoadHtml,
      mistralApiKey: input.mistralApiKey,
      mistralModel: input.mistralModel,
    });
    if (extracted.price <= 0) {
      throw new Error('Extracted price must be positive');
    }

    const decision = comparePrices({
      previousPrice: input.watch.lastPrice,
      previousCurrency: input.watch.lastCurrency,
      previousSource: input.watch.lastSource,
      currentPrice: extracted.price,
      currentCurrency: extracted.currency,
      currentSource: extracted.source,
    });

    const checkedAt = new Date().toISOString();
    const successUpdate: Partial<PriceCheckDocument> = {
      status: 'success',
      price: extracted.price,
      currency: extracted.currency,
      source: extracted.source,
      previousPrice: input.watch.lastPrice,
      dropped: decision.kind === 'drop',
      error: null,
      checkedAt,
    };
    await input.store.finishPriceCheck(checkId, successUpdate);

    const nextWatch: WatchDocument = {
      ...input.watch,
      title: input.watch.title ?? extracted.title ?? null,
      lastPrice: extracted.price,
      lastCurrency: extracted.currency,
      lastSource: extracted.source,
      lastCheckedAt: checkedAt,
    };
    await input.store.upsertWatch(nextWatch);

    if (decision.kind === 'drop') {
      const notification = formatDropNotification({
        watch: nextWatch,
        previousPrice: decision.previousPrice,
        currentPrice: extracted.price,
        currency: extracted.currency,
      });
      await input.sendNtfy({
        baseUrl: input.ntfy.baseUrl,
        topic: input.ntfy.topic,
        title: notification.title,
        body: notification.body,
        priority: input.ntfy.priority,
      });
    }

    return { ...running, ...successUpdate };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failedUpdate: Partial<PriceCheckDocument> = {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      dropped: false,
      checkedAt: failedAt,
    };
    await input.store.finishPriceCheck(checkId, failedUpdate);
    return { ...running, ...failedUpdate };
  } finally {
    releaseWatchLock(input.watch.id);
  }
}

export async function runWatches(input: {
  watches: WatchDocument[];
  store: BillingStore;
  extractPrice?: typeof defaultExtractPrice;
  sendNtfy: typeof sendNtfyFn;
  ntfy: { baseUrl: string; topic: string; priority: string };
  browserLoadHtml: (url: string) => Promise<string>;
  mistralApiKey?: string;
  mistralModel?: string;
}): Promise<PriceCheckDocument[]> {
  const results: PriceCheckDocument[] = [];
  for (const watch of input.watches) {
    if (!watch.enabled) continue;
    if (isWatchLocked(watch.id)) continue;
    try {
      const check = await runWatch({
        watch,
        store: input.store,
        extractPrice: input.extractPrice,
        sendNtfy: input.sendNtfy,
        ntfy: input.ntfy,
        browserLoadHtml: input.browserLoadHtml,
        mistralApiKey: input.mistralApiKey,
        mistralModel: input.mistralModel,
      });
      results.push(check);
    } catch (error) {
      if (!(error instanceof WatchBusyError)) {
        throw error;
      }
    }
  }
  return results;
}
