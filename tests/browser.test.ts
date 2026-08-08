import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withBrowser } from '../src/browser.ts';

describe('withBrowser', () => {
  it('opens a page and closes cleanly', async () => {
    const title = await withBrowser(
      { headless: true, timeoutMs: 30000, saveErrorScreenshot: false },
      async (page) => {
        await page.setContent('<html><head><title>ok</title></head><body>hi</body></html>');
        return page.title();
      },
    );

    assert.equal(title, 'ok');
  });
});
