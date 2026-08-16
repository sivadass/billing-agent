import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtractField } from '../src/store/types.ts';
import { formatSuccessBody, formatFailureBody, sendNtfy } from '../src/notify.ts';

const billSchema: ExtractField[] = [
  { key: 'amount', label: 'Amount', type: 'price' },
  { key: 'dueDate', label: 'Due', type: 'date' },
  { key: 'billPeriod', label: 'Period', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'accountLabel', label: 'Account', type: 'string' },
];

describe('notify formatters', () => {
  it('renders schema-label lines from a generic result, in schema order', () => {
    const body = formatSuccessBody(
      {
        amount: '₹1,234.00',
        dueDate: '2026-08-20',
        billPeriod: 'Jun-Jul 2026',
        status: 'unpaid',
        accountLabel: '****5643',
      },
      billSchema,
    );
    assert.equal(
      body,
      'Amount: ₹1,234.00\nDue: 2026-08-20\nPeriod: Jun-Jul 2026\nStatus: unpaid\nAccount: ****5643',
    );
  });

  it('skips schema fields absent from the result', () => {
    const body = formatSuccessBody(
      { amount: '₹0', accountLabel: '****1234' },
      billSchema,
    );
    assert.equal(body, 'Amount: ₹0\nAccount: ****1234');
  });

  it('never renders result keys that are not part of the schema', () => {
    const body = formatSuccessBody(
      { amount: '₹0', accountLabel: '****1234', rawNotes: 'internal note' },
      billSchema,
    );
    assert.doesNotMatch(body, /internal note/);
  });

  it('renders an empty body for an empty schema', () => {
    const body = formatSuccessBody({ amount: '₹0' }, []);
    assert.equal(body, '');
  });

  it('formats failure body with code', () => {
    const body = formatFailureBody('home-eb', { code: 'LoginError', message: 'bad credentials' });
    assert.match(body, /home-eb/);
    assert.match(body, /LoginError/);
    assert.match(body, /bad credentials/);
  });
});

describe('sendNtfy', () => {
  it('retries once on 502 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response('bad gateway', { status: 502 });
      return new Response('ok', { status: 200 });
    };
    await sendNtfy({
      baseUrl: 'https://ntfy.sh',
      topic: 't',
      title: 'hi',
      body: 'body',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assert.equal(calls, 2);
  });
});
