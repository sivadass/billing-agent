import { chromium, type Page } from 'playwright';
import type { BrowserConfig } from './config.js';

const launchArgs = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--js-flags=--max-old-space-size=128',
];

export async function withBrowser<T>(
  config: BrowserConfig,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const args = config.noSandbox ? [...launchArgs, '--no-sandbox'] : launchArgs;
  const browser = await chromium.launch({ headless: config.headless, args });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    return await fn(page);
  } finally {
    await browser.close();
  }
}
