import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  BILL_PAYMENTS_TBODY_ID,
  DISCONNECTED_TBODY_ID,
  dataTableIsEmptyInHtml,
  firstAdvanceConsumerNoFromHtml,
  hasNoPendingBillsInHtml,
  isNoRecordsEmptyMessage,
  maskAccount,
} from '../src/adapters/tnpdcl.ts';

const emptyHtml = readFileSync(
  resolve('fixtures/tnpdcl-grouppay-empty.html'),
  'utf8',
);
const oneBillHtml = readFileSync(
  resolve('fixtures/tnpdcl-grouppay-one-bill.html'),
  'utf8',
);

describe('isNoRecordsEmptyMessage', () => {
  it('matches No records found text', () => {
    assert.equal(isNoRecordsEmptyMessage('No records found.'), true);
    assert.equal(isNoRecordsEmptyMessage('  no records found  '), true);
    assert.equal(isNoRecordsEmptyMessage('Rs.150.00'), false);
  });
});

describe('dataTableIsEmptyInHtml', () => {
  it('returns true for empty bill payments tbody', () => {
    assert.equal(
      dataTableIsEmptyInHtml(emptyHtml, BILL_PAYMENTS_TBODY_ID),
      true,
    );
    assert.equal(
      dataTableIsEmptyInHtml(emptyHtml, DISCONNECTED_TBODY_ID),
      true,
    );
  });

  it('returns false when bill payments has a data row', () => {
    assert.equal(
      dataTableIsEmptyInHtml(oneBillHtml, BILL_PAYMENTS_TBODY_ID),
      false,
    );
    assert.equal(
      dataTableIsEmptyInHtml(oneBillHtml, DISCONNECTED_TBODY_ID),
      true,
    );
  });

  it('returns null when tbody id is missing', () => {
    assert.equal(
      dataTableIsEmptyInHtml('<html><body></body></html>', BILL_PAYMENTS_TBODY_ID),
      null,
    );
  });
});

describe('hasNoPendingBillsInHtml', () => {
  it('is true only when both tables are empty', () => {
    assert.equal(hasNoPendingBillsInHtml(emptyHtml), true);
    assert.equal(hasNoPendingBillsInHtml(oneBillHtml), false);
    assert.equal(hasNoPendingBillsInHtml('<html></html>'), false);
  });
});

describe('firstAdvanceConsumerNoFromHtml', () => {
  it('reads the first Advance Payments consumer number', () => {
    assert.equal(firstAdvanceConsumerNoFromHtml(emptyHtml), '0921410333');
    assert.equal(
      maskAccount(firstAdvanceConsumerNoFromHtml(emptyHtml)!),
      '****0333',
    );
  });

  it('returns undefined when Advance Payments is absent', () => {
    assert.equal(firstAdvanceConsumerNoFromHtml(oneBillHtml), undefined);
  });
});
