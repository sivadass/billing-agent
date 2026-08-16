import type { JobEngine } from './types';

/** `adapter:tnpdcl` for the compatibility adapters, plain `workflow` otherwise. */
export function engineLabel(input: { engine: JobEngine; adapterId?: string }): string {
  if (input.engine === 'adapter' && input.adapterId) {
    return `adapter:${input.adapterId}`;
  }
  return input.engine;
}
