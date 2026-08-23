const SECRET_PATTERN = /\[secret:[^\]]+\]/g;

export function sanitizeMessageText(text: string): string {
  return text.replace(SECRET_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}
