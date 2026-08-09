import { createServer } from 'node:http';
import type { BillingStore } from '@billing-agent/core';
import { handleRoute } from './routes.js';

export type StartServerInput = {
  port: number;
  token: string;
  store: BillingStore;
};

export type ApiServerHandle = {
  port: number;
  close(): Promise<void>;
};

export async function startServer(input: StartServerInput): Promise<ApiServerHandle> {
  const server = createServer((req, res) => {
    void handleRoute(req, res, { token: input.token, store: input.store }).catch(
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
