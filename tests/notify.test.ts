import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSuccessBody, formatFailureBody, sendNtfy } from '../src/notify.ts';

describe('notify formatters', () => {
  it('formats success body fields', () => {
    const body = formatSuccessBody({
      provider: 'tnpdcl',
      amount: '₹1,234.00',
      dueDate: '2026-08-20',
      billPeriod: 'Jun-Jul 2026',
      status: 'unpaid',
      accountLabel: '****5643',
    });
    assert.match(body, /₹1,234\.00/);
    assert.match(body, /2026-08-20/);
    assert.match(body, /Jun-Jul 2026/);
    assert.match(body, /unpaid/);
    assert.match(body, /\*\*\*\*5643/);
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
