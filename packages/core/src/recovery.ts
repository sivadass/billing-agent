import type { Page } from 'playwright';
import { ConfigError } from './errors.js';
import { validateOverlayPatch, type SelectorOverlay } from './overlay.js';

const MAX_COMPACT_DOM_LENGTH = 12_000;

export type RecoveryDeps = {
  completeJson: (args: {
    system: string;
    user: string;
    imageBase64?: string;
  }) => Promise<string>;
};

export async function extractCompactDom(page: Page): Promise<string> {
  const compact = await page.evaluate(() => {
    const items: string[] = [];
    const include = new Set(['input', 'label', 'button', 'select', 'textarea']);
    const nodes = Array.from(document.querySelectorAll('*'));
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const tag = node.tagName.toLowerCase();
      if (!include.has(tag) && !node.id && !node.getAttribute('name')) continue;
      const id = node.id ? ` id="${node.id}"` : '';
      const name = node.getAttribute('name')
        ? ` name="${node.getAttribute('name')}"`
        : '';
      const ariaLabel = node.getAttribute('aria-label')
        ? ` aria-label="${node.getAttribute('aria-label')}"`
        : '';
      const text = node.textContent?.trim();
      const snippet = `<${tag}${id}${name}${ariaLabel}>${text ? ` ${text.slice(0, 120)}` : ''}`;
      items.push(snippet);
      if (items.length >= 250) break;
    }
    return items.join('\n');
  });
  return compact.slice(0, MAX_COMPACT_DOM_LENGTH);
}

export async function proposeOverlayPatch(
  input: {
    errorMessage: string;
    screenshotBase64?: string;
    compactDom: string;
    allowedKeys: string[];
  },
  deps: RecoveryDeps,
): Promise<SelectorOverlay> {
  const system =
    'You are a selector recovery assistant. Return only JSON object with selector or regex pattern overrides.';
  const user = [
    `Error message: ${input.errorMessage}`,
    `Allowed keys: ${input.allowedKeys.join(', ')}`,
    'Compact DOM snapshot:',
    input.compactDom,
    'Return only JSON.',
  ].join('\n');

  const raw = await deps.completeJson({
    system,
    user,
    imageBase64: input.screenshotBase64,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError('Recovery response must be valid JSON', { cause: error });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError('Recovery response must be a JSON object');
  }

  for (const key of Object.keys(parsed)) {
    if (!input.allowedKeys.includes(key)) {
      throw new ConfigError(`Recovery response contains disallowed key: ${key}`);
    }
  }

  return validateOverlayPatch(parsed);
}
