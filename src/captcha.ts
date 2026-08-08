import { Mistral } from '@mistralai/mistralai';
import type { ChatCompletionRequest } from '@mistralai/mistralai/models/components/chatcompletionrequest.js';
import type { ChatCompletionResponse } from '@mistralai/mistralai/models/components/chatcompletionresponse.js';
import type { ContentChunk } from '@mistralai/mistralai/models/components/contentchunk.js';
import { CaptchaError } from './errors.ts';

const CAPTCHA_PROMPT =
  'Read the captcha image. Reply with only the captcha characters. No spaces, no punctuation, no explanation.';

export type CompleteFn = (
  request: ChatCompletionRequest,
) => Promise<ChatCompletionResponse | string>;

export type CaptchaSolver = {
  solveFromImageBase64(base64Png: string): Promise<string>;
};

function extractMessageContent(
  content: string | Array<ContentChunk> | null | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is ContentChunk & { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function normalizeCaptchaText(raw: string): string {
  const normalized = raw.trim().replace(/[\s"']/g, '');
  if (!normalized) {
    throw new CaptchaError('empty captcha response');
  }
  if (normalized.length > 12) {
    throw new CaptchaError('captcha response too long');
  }
  return normalized;
}

export function createMistralCaptchaSolver(opts: {
  apiKey: string;
  model: string;
  complete?: CompleteFn;
}): CaptchaSolver {
  const complete =
    opts.complete ??
    (async (request: ChatCompletionRequest) => {
      const mistral = new Mistral({ apiKey: opts.apiKey });
      return mistral.chat.complete(request);
    });

  return {
    async solveFromImageBase64(base64Png: string): Promise<string> {
      const response = await complete({
        model: opts.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: CAPTCHA_PROMPT },
              {
                type: 'image_url',
                imageUrl: `data:image/png;base64,${base64Png}`,
              },
            ],
          },
        ],
      });

      const raw =
        typeof response === 'string'
          ? response
          : extractMessageContent(response.choices[0]?.message?.content);
      return normalizeCaptchaText(raw);
    },
  };
}

export async function solveCaptchaFromLocator(
  locator: { screenshot: (opts?: { type?: 'png' }) => Promise<Buffer> },
  solver: CaptchaSolver,
): Promise<string> {
  const buf = await locator.screenshot({ type: 'png' });
  return solver.solveFromImageBase64(buf.toString('base64'));
}
