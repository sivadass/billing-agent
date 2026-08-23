/** Reads the first numeric amount out of a price string (`Rs. 8,450.00` → 8450). */
export function parsePriceString(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/₹/g, ' ')
    .replace(/rs\.?/gi, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  if (!normalized) return null;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const value = Number.parseFloat(match[0]);
  if (!Number.isFinite(value)) return null;
  return value;
}
