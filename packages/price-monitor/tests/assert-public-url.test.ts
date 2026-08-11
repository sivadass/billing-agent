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
});
