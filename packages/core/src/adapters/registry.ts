import { ConfigError } from '../errors.js';
import { dummyAdapter } from './dummy.js';
import { tnpdclAdapter } from './tnpdcl.js';
import type { BillingAdapter } from './types.js';

const adapters = new Map<string, BillingAdapter>();

export function registerAdapter(adapter: BillingAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(provider: string): BillingAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new ConfigError(`Unknown provider: ${provider}`);
  }
  return adapter;
}

export function registerBuiltInAdapters(): void {
  registerAdapter(dummyAdapter);
  registerAdapter(tnpdclAdapter);
}
