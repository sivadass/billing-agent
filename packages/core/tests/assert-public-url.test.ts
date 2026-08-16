import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertPublicHttpUrl } from '../src/assert-public-url.ts';

describe('assertPublicHttpUrl', () => {
  it('accepts public http and https urls', () => {
    assert.equal(assertPublicHttpUrl('https://example.com/product').hostname, 'example.com');
    assert.equal(assertPublicHttpUrl('http://example.org').protocol, 'http:');
  });

  it('rejects non-http(s) protocols', () => {
    assert.throws(() => assertPublicHttpUrl('ftp://example.com/file'));
  });

  it('rejects credentials in url', () => {
    assert.throws(() => assertPublicHttpUrl('https://user:pass@example.com'));
  });

  it('rejects localhost and private domains', () => {
    assert.throws(() => assertPublicHttpUrl('http://localhost:3000'));
    assert.throws(() => assertPublicHttpUrl('http://api.localhost'));
    assert.throws(() => assertPublicHttpUrl('https://service.internal/path'));
    assert.throws(() => assertPublicHttpUrl('https://app.local/path'));
  });

  it('rejects private, loopback, and metadata ipv4 addresses', () => {
    assert.throws(() => assertPublicHttpUrl('http://127.0.0.1'));
    assert.throws(() => assertPublicHttpUrl('http://10.0.0.8'));
    assert.throws(() => assertPublicHttpUrl('http://172.16.0.5'));
    assert.throws(() => assertPublicHttpUrl('http://192.168.1.2'));
    assert.throws(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data'));
  });

  it('rejects loopback and link-local ipv6 addresses', () => {
    assert.throws(() => assertPublicHttpUrl('http://[::1]'));
    assert.throws(() => assertPublicHttpUrl('http://[fe80::1]'));
  });

  it('rejects the unspecified 0.0.0.0/8 range', () => {
    // 0.0.0.0 routes to every local interface on Linux, so it reaches
    // localhost services just like 127.0.0.1.
    assert.throws(() => assertPublicHttpUrl('http://0.0.0.0'));
    assert.throws(() => assertPublicHttpUrl('http://0.0.0.0:8080/jobs'));
    assert.throws(() => assertPublicHttpUrl('http://0.1.2.3'));
    assert.throws(() => assertPublicHttpUrl('http://[::]'));
  });

  it('rejects ipv4-mapped and ipv4-compatible ipv6 addresses', () => {
    for (const host of [
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]',
      '[::FFFF:169.254.169.254]',
      '[::ffff:a9fe:a9fe]',
      '[::ffff:10.0.0.8]',
      '[::ffff:192.168.1.2]',
      '[::ffff:172.16.0.5]',
      '[::ffff:0.0.0.0]',
      '[0:0:0:0:0:ffff:127.0.0.1]',
      '[0000:0000:0000:0000:0000:ffff:7f00:0001]',
      '[::127.0.0.1]',
      '[::169.254.169.254]',
    ]) {
      assert.throws(() => assertPublicHttpUrl(`http://${host}/`), host);
    }
  });

  it('still accepts public ip literals', () => {
    // Guards against the private-range checks over-matching: these are all
    // public addresses that sit next to blocked ranges.
    for (const host of [
      '8.8.8.8',
      '1.1.1.1',
      '11.0.0.1',
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '169.253.0.1',
      '100.64.0.1',
    ]) {
      assert.equal(assertPublicHttpUrl(`https://${host}/x`).hostname, host);
    }
    assert.equal(
      assertPublicHttpUrl('https://[2606:4700:4700::1111]/x').hostname,
      '[2606:4700:4700::1111]',
    );
    assert.equal(
      assertPublicHttpUrl('https://[::ffff:8.8.8.8]/x').protocol,
      'https:',
    );
  });

  it('does not resolve DNS (rebinding-proof checks are a v1 non-goal)', () => {
    // A hostname that resolves to a private address is still accepted: v1
    // deliberately does no DNS lookups, so nip.io-style hosts pass.
    assert.equal(
      assertPublicHttpUrl('https://127-0-0-1.nip.io/path').hostname,
      '127-0-0-1.nip.io',
    );
  });
});
