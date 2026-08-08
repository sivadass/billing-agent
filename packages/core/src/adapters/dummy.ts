import { resolve } from 'node:path';
import { mergeSelectors } from '../overlay.js';
import { pathToFileURL } from 'node:url';
import type { BillingAdapter } from './types.js';

const defaultSelectors = {
  amount: '[data-testid="amount"]',
  dueDate: '[data-testid="due-date"]',
  billPeriod: '[data-testid="bill-period"]',
  status: '[data-testid="status"]',
  accountLabel: '[data-testid="account"]',
} as const;

export const dummyAdapter: BillingAdapter = {
  id: 'dummy',

  async run(ctx) {
    const fixturePath =
      ctx.fixturePath ?? resolve(process.cwd(), 'fixtures/dummy-bill.html');
    await ctx.page.goto(pathToFileURL(fixturePath).href);

    const selectors = mergeSelectors(defaultSelectors, ctx.overlay);

    const amount = (await ctx.page.locator(selectors.amount).innerText()).trim();
    const dueDate = (await ctx.page.locator(selectors.dueDate).innerText()).trim();
    const billPeriod = (
      await ctx.page.locator(selectors.billPeriod).innerText()
    ).trim();
    const status = (await ctx.page.locator(selectors.status).innerText()).trim();
    const account = (await ctx.page.locator(selectors.accountLabel).innerText()).trim();

    return {
      provider: 'dummy',
      amount,
      dueDate,
      billPeriod,
      status,
      accountLabel: `****${account.slice(-4)}`,
    };
  },
};
