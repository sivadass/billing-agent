import type { Page } from 'playwright';
import type { CaptchaSolver } from '../captcha.js';
import type { Logger } from '../logger.js';
import type { SelectorOverlay } from '../overlay.js';

export type BillResult = {
  provider: string;
  amount: string;
  dueDate?: string;
  billPeriod?: string;
  status?: string;
  accountLabel: string;
  rawNotes?: string;
  /** When false, job-runner skips success ntfy. Default: notify. */
  notify?: boolean;
};

export type AdapterContext = {
  page: Page;
  credentials: Record<string, string>;
  captchaSolver: CaptchaSolver;
  timeoutMs: number;
  logger: Logger;
  overlay?: SelectorOverlay;
  fixturePath?: string;
};

export interface BillingAdapter {
  id: string;
  run(ctx: AdapterContext): Promise<BillResult>;
}
