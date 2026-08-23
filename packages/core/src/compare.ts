import { parsePriceString } from './extract/parse-price.js';
import type { ExtractField, NotifyOn } from './store/types.js';

export type NotifyDecision = 'send_success' | 'skip_success' | 'send_failure';

function projectResult(
  result: Record<string, unknown> | null,
  schema: ExtractField[],
): Record<string, string | number> {
  if (!result) return {};
  const projected: Record<string, string | number> = {};
  for (const field of schema) {
    const value = result[field.key];
    if (typeof value === 'string' || typeof value === 'number') {
      projected[field.key] = value;
    }
  }
  return projected;
}

function resultsEqual(
  current: Record<string, unknown> | null,
  previous: Record<string, string | number> | null,
  schema: ExtractField[],
): boolean {
  return (
    JSON.stringify(projectResult(current, schema)) ===
    JSON.stringify(previous ?? {})
  );
}

function priceField(schema: ExtractField[]): ExtractField | undefined {
  return schema.find((field) => field.type === 'price');
}

function numericPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    return parsePriceString(value);
  }
  return null;
}

function evaluateDrop(input: {
  result: Record<string, unknown>;
  lastResult: Record<string, string | number> | null;
  schema: ExtractField[];
}): NotifyDecision {
  const field = priceField(input.schema);
  if (!field) return 'skip_success';

  const currentPrice = numericPrice(input.result[field.key]);
  if (currentPrice === null || currentPrice <= 0) return 'skip_success';

  if (input.lastResult === null) return 'skip_success';

  const previousPrice = numericPrice(input.lastResult[field.key]);
  if (previousPrice === null || previousPrice <= 0) return 'skip_success';

  const currencyKey = input.schema.some((item) => item.key === 'currency')
    ? 'currency'
    : null;
  if (currencyKey) {
    const currentCurrency = input.result[currencyKey];
    const previousCurrency = input.lastResult[currencyKey];
    if (
      previousCurrency !== undefined &&
      currentCurrency !== undefined &&
      String(previousCurrency) !== String(currentCurrency)
    ) {
      return 'skip_success';
    }
  }

  return currentPrice < previousPrice ? 'send_success' : 'skip_success';
}

export function decideNotify(input: {
  on: NotifyOn;
  status: 'success' | 'failed';
  result: Record<string, unknown> | null;
  lastResult: Record<string, string | number> | null;
  schema: ExtractField[];
  adapterNotify?: boolean;
}): NotifyDecision {
  if (input.status === 'failed') {
    return 'send_failure';
  }

  if (input.adapterNotify === false) {
    return 'skip_success';
  }

  switch (input.on) {
    case 'always':
      return 'send_success';
    case 'failure_only':
      return 'skip_success';
    case 'change':
      return resultsEqual(input.result, input.lastResult, input.schema)
        ? 'skip_success'
        : input.lastResult === null
          ? 'skip_success'
          : 'send_success';
    case 'drop':
      return input.result
        ? evaluateDrop({
            result: input.result,
            lastResult: input.lastResult,
            schema: input.schema,
          })
        : 'skip_success';
    default:
      return 'skip_success';
  }
}
