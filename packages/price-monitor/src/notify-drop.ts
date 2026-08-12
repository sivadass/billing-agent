import type { WatchDocument } from '@billing-agent/core';

export function formatDropNotification(input: {
  watch: WatchDocument;
  previousPrice: number;
  currentPrice: number;
  currency: string;
}): { title: string; body: string } {
  const title = `Price dropped: ${input.watch.title ?? input.watch.url}`;
  const body = [
    `Watch: ${input.watch.id}`,
    `URL: ${input.watch.url}`,
    `Previous: ${input.currency} ${input.previousPrice}`,
    `Current: ${input.currency} ${input.currentPrice}`,
  ].join('\n');
  return { title, body };
}
