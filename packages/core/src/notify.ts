import type { ExtractField } from './store/types.js';
import { NotifyError } from './errors.js';

const RETRY_DELAY_MS = 250;

/**
 * Renders a generic run result as `Label: value` lines, in schema order.
 * Fields absent from `result` (undefined/null) are skipped. Fields present
 * in `result` but not described by `schema` are not rendered — only schema
 * fields are ever shown to the user.
 */
export function formatSuccessBody(
  result: Record<string, unknown>,
  schema: ExtractField[],
): string {
  const lines = schema
    .filter((field) => result[field.key] !== undefined && result[field.key] !== null)
    .map((field) => `${field.label}: ${result[field.key]}`);
  return lines.join('\n');
}

export function formatFailureBody(
  jobId: string,
  err: { code?: string; message: string },
  screenshotPath?: string,
): string {
  const lines: string[] = [`Job: ${jobId}`];
  if (err.code) lines.push(`Error: ${err.code}`);
  lines.push(err.message);
  if (screenshotPath) lines.push(`Screenshot: ${screenshotPath}`);
  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  const text = await readErrorText(response);
  throw new NotifyError(`ntfy request failed: ${response.status} ${text}`);
}

export async function sendNtfy(opts: {
  baseUrl: string;
  topic: string;
  title: string;
  body: string;
  priority?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, '')}/${opts.topic}`;
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      Title: opts.title,
      Priority: opts.priority ?? 'default',
      'Content-Type': 'text/plain',
    },
    body: opts.body,
  };

  const attempt = async (): Promise<Response> => fetchFn(url, requestInit);

  let response: Response;
  try {
    response = await attempt();
  } catch (err) {
    await sleep(RETRY_DELAY_MS);
    try {
      response = await attempt();
    } catch (retryErr) {
      const message =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new NotifyError(`ntfy request failed: ${message}`, { cause: retryErr });
    }
    await ensureOk(response);
    return;
  }

  if (response.ok) return;

  if (response.status >= 500) {
    await sleep(RETRY_DELAY_MS);
    try {
      response = await attempt();
    } catch (retryErr) {
      const message =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new NotifyError(`ntfy request failed: ${message}`, { cause: retryErr });
    }
    await ensureOk(response);
    return;
  }

  await ensureOk(response);
}
