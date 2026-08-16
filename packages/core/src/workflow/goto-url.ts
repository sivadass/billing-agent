import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPublicHttpUrl, PublicUrlError } from '../assert-public-url.js';
import { ConfigError } from '../errors.js';

/**
 * `<repo>/fixtures`, derived from this module's own location so it is identical
 * whether the interpreter runs from `src/` (tsx) or `dist/` (built worker):
 * both `packages/core/src/workflow` and `packages/core/dist/workflow` sit four
 * levels below the repo root.
 */
export function repoFixturesDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '..', '..', 'fixtures');
}

function canonicalPath(target: string, label: string): string {
  try {
    return realpathSync(target);
  } catch {
    throw new ConfigError(
      `workflow goto: ${label} does not exist (${target}); file: urls must point at an existing file inside the repo fixtures directory`,
    );
  }
}

/**
 * `file:` URLs exist only for the local login/captcha interpreter tests, so the
 * canonical (symlink-resolved) target must live inside the repo `fixtures/`
 * directory. Resolving both sides with `realpathSync` before comparing blocks
 * `..` traversal and symlinks that point out of the tree.
 */
function resolveFixtureFileUrl(parsed: URL): string {
  const fixturesDir = canonicalPath(repoFixturesDir(), 'fixtures directory');
  const target = canonicalPath(fileURLToPath(parsed), 'file');
  const relative = path.relative(fixturesDir, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ConfigError(
      `workflow goto: file: urls must resolve inside the repo fixtures directory (${fixturesDir})`,
    );
  }
  return pathToFileURL(target).href;
}

/**
 * Returns the URL the interpreter may navigate to: any public http(s) URL, or a
 * `file:` URL under the repo fixtures directory. Everything else (including
 * `data:`, `javascript:`, private hosts and credential-bearing URLs) throws
 * `ConfigError`.
 */
export function resolveWorkflowGotoUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError('workflow goto: url must be an absolute URL');
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    try {
      return assertPublicHttpUrl(url).toString();
    } catch (error) {
      const reason = error instanceof PublicUrlError ? error.message : 'invalid url';
      throw new ConfigError(`workflow goto: url is not allowed (${reason})`);
    }
  }

  if (parsed.protocol === 'file:') {
    return resolveFixtureFileUrl(parsed);
  }

  throw new ConfigError(
    `workflow goto: url protocol "${parsed.protocol}" is not allowed`,
  );
}
