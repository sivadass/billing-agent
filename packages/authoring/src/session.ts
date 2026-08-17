import type { Browser, BrowserContext, Page } from 'playwright';

export type AuthoringSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  turnsThisMessage: number;
  turnsTotal: number;
  /** Last user message id processed at the start of the current turn batch. */
  lastProcessedMessageId: string | null;
};

const sessions = new Map<string, AuthoringSession>();

export function getAuthoringSession(conversationId: string): AuthoringSession | undefined {
  return sessions.get(conversationId);
}

export function setAuthoringSession(conversationId: string, session: AuthoringSession): void {
  sessions.set(conversationId, session);
}

export function deleteAuthoringSession(conversationId: string): void {
  sessions.delete(conversationId);
}

export function listAuthoringSessionIds(): string[] {
  return [...sessions.keys()];
}

export async function closeAuthoringSession(conversationId: string): Promise<void> {
  const session = sessions.get(conversationId);
  if (!session) return;
  sessions.delete(conversationId);
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
}
