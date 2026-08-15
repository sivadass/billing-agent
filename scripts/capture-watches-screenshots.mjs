#!/usr/bin/env node
/**
 * Captures watches listing and detail page screenshots with mocked API responses.
 * Usage: node scripts/capture-watches-screenshots.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4173';
const outDir = '/opt/cursor/artifacts/screenshots';

const mockWatches = [
  {
    id: 'craft-glory-old-skool-vb',
    url: 'https://craftandglory.in/products/old-skool-retro-leather-sneakers',
    title: 'Old Skool Retro Leather Sneakers',
    enabled: true,
    schedule: '0 9 * * *',
    lastPrice: 2499,
    lastCurrency: 'INR',
    lastSource: 'shopify_json',
    lastCheckedAt: new Date(Date.now() - 3600000).toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'nike-air-max-90',
    url: 'https://example.com/products/nike-air-max-90',
    title: 'Nike Air Max 90',
    enabled: false,
    schedule: null,
    lastPrice: 8999,
    lastCurrency: 'INR',
    lastSource: 'shopify_json',
    lastCheckedAt: new Date(Date.now() - 86400000).toISOString(),
    createdAt: new Date().toISOString(),
  },
];

const mockChecks = [
  {
    id: 'check-success-001',
    watchId: 'craft-glory-old-skool-vb',
    status: 'success',
    price: 2499,
    currency: 'INR',
    source: 'shopify_json',
    previousPrice: 2799,
    dropped: true,
    error: null,
    checkedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'check-failed-002',
    watchId: 'craft-glory-old-skool-vb',
    status: 'failed',
    price: null,
    currency: null,
    source: null,
    previousPrice: null,
    dropped: false,
    error: 'Product page returned 503',
    checkedAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'check-running-003',
    watchId: 'craft-glory-old-skool-vb',
    status: 'running',
    price: null,
    currency: null,
    source: null,
    previousPrice: null,
    dropped: false,
    error: null,
    checkedAt: new Date().toISOString(),
  },
];

async function mockApi(route) {
  const url = route.request().url();
  if (url.endsWith('/watches') && route.request().method() === 'GET') {
    await route.fulfill({ status: 200, body: JSON.stringify(mockWatches) });
    return;
  }
  if (url.includes('/watches/craft-glory-old-skool-vb/checks')) {
    await route.fulfill({ status: 200, body: JSON.stringify(mockChecks) });
    return;
  }
  if (url.endsWith('/watches/craft-glory-old-skool-vb') && route.request().method() === 'GET') {
    await route.fulfill({ status: 200, body: JSON.stringify(mockWatches[0]) });
    return;
  }
  if (url.includes('/watches/nike-air-max-90/checks')) {
    await route.fulfill({
      status: 200,
      body: JSON.stringify([
        {
          id: 'check-never',
          watchId: 'nike-air-max-90',
          status: 'success',
          price: 8999,
          currency: 'INR',
          source: 'shopify_json',
          previousPrice: null,
          dropped: false,
          error: null,
          checkedAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ]),
    });
    return;
  }
  await route.continue();
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    sessionStorage.setItem('billing-agent.jwt', 'mock-screenshot-token');
  });

  await page.route('http://127.0.0.1:8080/**', mockApi);

  await page.goto(`${baseUrl}/watches`, { waitUntil: 'networkidle' });
  await page.waitForSelector('table', { timeout: 15000 });
  await page.screenshot({
    path: join(outDir, 'watches-listing.png'),
    fullPage: true,
  });

  await page.goto(`${baseUrl}/watches/craft-glory-old-skool-vb`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('text=Price check history', { timeout: 15000 });
  await page.screenshot({
    path: join(outDir, 'watch-detail.png'),
    fullPage: true,
  });

  await browser.close();
  console.log('Screenshots saved to', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
