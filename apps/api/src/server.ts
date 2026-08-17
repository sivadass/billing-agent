import { createServer } from 'node:http';
import type { BillingStore, BrowserLock } from '@billing-agent/core';
import { applyCors } from './cors.js';
import { handleRoute } from './routes.js';

export type StartServerInput = {
  port: number;
  jwtSecret: string;
  store: BillingStore;
  corsOrigins?: string[];
  onRunJob?: (jobId: string) => Promise<string>;
  onRunWatch?: (watchId: string) => Promise<string>;
  onAuthorConversation?: (conversationId: string) => Promise<void>;
  /** Source of `SECRETS_MASTER_KEY` for the job secrets routes. */
  env?: NodeJS.ProcessEnv;
  /** Shared with the worker's runner and scheduler so Run now can answer 409 while the browser is in use. */
  lock?: BrowserLock;
};

export type ApiServerHandle = {
  port: number;
  close(): Promise<void>;
};

export async function startServer(input: StartServerInput): Promise<ApiServerHandle> {
  const corsOrigins = input.corsOrigins ?? [];

  const server = createServer((req, res) => {
    const { handled } = applyCors(req, res, corsOrigins);
    if (handled) return;

    void handleRoute(req, res, {
      jwtSecret: input.jwtSecret,
      store: input.store,
      onRunJob: input.onRunJob,
      onRunWatch: input.onRunWatch,
      onAuthorConversation: input.onAuthorConversation,
      env: input.env ?? process.env,
      lock: input.lock,
    }).catch(
      (error: unknown) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, '0.0.0.0', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine listening port');
  }

  return {
    port: address.port,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
