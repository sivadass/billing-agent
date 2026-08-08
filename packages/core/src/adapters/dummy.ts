import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BillingAdapter } from './types.js';

export const dummyAdapter: BillingAdapter = {
  id: 'dummy',

  async run(ctx) {
    const fixturePath =
      ctx.fixturePath ?? resolve(process.cwd(), 'fixtures/dummy-bill.html');
    await ctx.page.goto(pathToFileURL(fixturePath).href);

    const amount = (await ctx.page.getByTestId('amount').innerText()).trim();
    const dueDate = (await ctx.page.getByTestId('due-date').innerText()).trim();
    const billPeriod = (
      await ctx.page.getByTestId('bill-period').innerText()
    ).trim();
    const status = (await ctx.page.getByTestId('status').innerText()).trim();
    const account = (await ctx.page.getByTestId('account').innerText()).trim();

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
