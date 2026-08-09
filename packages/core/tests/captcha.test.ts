import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMistralCaptchaSolver, solveCaptchaFromLocator } from '../src/captcha.ts';
import { CaptchaError } from '../src/errors.ts';

describe('captcha solver', () => {
  it('returns normalized text from model', async () => {
    const solver = createMistralCaptchaSolver({
      apiKey: 'x',
      model: 'mistral-small-latest',
      complete: async () => ' Ab12 ',
    });
    const text = await solver.solveFromImageBase64('aaa');
    assert.equal(text, 'Ab12');
  });

  it('throws CaptchaError on empty', async () => {
    const solver = createMistralCaptchaSolver({
      apiKey: 'x',
      model: 'mistral-small-latest',
      complete: async () => '   ',
    });
    await assert.rejects(() => solver.solveFromImageBase64('aaa'), CaptchaError);
  });

  it('strips spaces and quotes', async () => {
    const solver = createMistralCaptchaSolver({
      apiKey: 'x',
      model: 'mistral-small-latest',
      complete: async () => ' "A b 12" ',
    });
    const text = await solver.solveFromImageBase64('aaa');
    assert.equal(text, 'Ab12');
  });

  it('throws CaptchaError when normalized length exceeds 12', async () => {
    const solver = createMistralCaptchaSolver({
      apiKey: 'x',
      model: 'mistral-small-latest',
      complete: async () => 'abcdefghijklm',
    });
    await assert.rejects(() => solver.solveFromImageBase64('aaa'), CaptchaError);
  });
});

describe('solveCaptchaFromLocator', () => {
  it('screenshots locator and delegates to solver', async () => {
    const png = Buffer.from('fake-png');
    const locator = {
      screenshot: async (opts?: { type?: 'png' }) => {
        assert.equal(opts?.type, 'png');
        return png;
      },
    };
    const solver = {
      solveFromImageBase64: async (base64Png: string) => {
        assert.equal(base64Png, png.toString('base64'));
        return 'Xy9';
      },
    };
    const text = await solveCaptchaFromLocator(locator, solver);
    assert.equal(text, 'Xy9');
  });
});
