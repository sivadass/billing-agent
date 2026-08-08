import type { Page } from 'playwright';
import type { CaptchaSolver } from '../captcha.js';
import type { Logger } from '../logger.js';

export type BillResult = {
  provider: string;
  amount: string;
  dueDate?: string;
  billPeriod?: string;
  status?: string;
  accountLabel: string;
  rawNotes?: string;
};

export type AdapterContext = {
  page: Page;
  credentials: Record<string, string>;
  captchaSolver: CaptchaSolver;
  timeoutMs: number;
  logger: Logger;
  fixturePath?: string;
};

export interface BillingAdapter {
  id: string;
  run(ctx: AdapterContext): Promise<BillResult>;
}
