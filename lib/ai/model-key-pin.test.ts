import { afterEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { temporaryDirectory } from '@/lib/testing/temporary-directory';
import { z } from '@/lib/zod';

// The local test server replays recorded streams and must never call a paid
// model (werk-flow/werkflow-planning#530). scripts/test-server.ts pins
// WERKFLOW_KI_ANTHROPIC_KEY to empty for its build and server; Next's env
// loading never replaces a variable the process already has, so a key in the
// checkout's .env.local stays out.
const KEY = 'WERKFLOW_KI_ANTHROPIC_KEY';

type LoadEnvConfig = (directory: string, dev: boolean, log: object, forceReload: boolean) => unknown;

function isEnvModule(value: unknown): value is { loadEnvConfig: LoadEnvConfig } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'loadEnvConfig' in value &&
    typeof value.loadEnvConfig === 'function'
  );
}

/** The env loader of the installed Next, resolved from Next itself: the code `next build` and `next start` run. */
function nextEnvLoader(): LoadEnvConfig {
  const loaded: unknown = createRequire(Bun.resolveSync('next/package.json', import.meta.dir))('@next/env');
  if (!isEnvModule(loaded)) throw new Error('Next ships no loadEnvConfig');
  return loaded.loadEnvConfig;
}
const original = { key: process.env[KEY], mode: process.env.NODE_ENV };

/** Sets or removes a variable; Next types NODE_ENV as read-only. */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else Reflect.set(process.env, name, value);
}

afterEach(() => {
  setEnv(KEY, original.key);
  setEnv('NODE_ENV', original.mode);
});

const loaded = z.object({ loadedEnvFiles: z.array(z.object({ path: z.string() })) });

test('an env file cannot override the test server’s empty model key', () => {
  const directory = temporaryDirectory('model-key-pin-');
  writeFileSync(join(directory, '.env.local'), `${KEY}=synthetic-key-from-a-file\n`);
  writeFileSync(join(directory, '.env.production'), `${KEY}=synthetic-key-from-a-file\n`);
  setEnv(KEY, '');
  // `bun test` runs with NODE_ENV=test, where Next loads only the test files; the server runs in production mode.
  setEnv('NODE_ENV', 'production');
  const result = loaded.parse(
    nextEnvLoader()(directory, false, { info: () => undefined, error: () => undefined }, true),
  );
  expect(
    result.loadedEnvFiles.map((file) => file.path).toSorted(),
    'the loader must read the env files that carry a key',
  ).toEqual(['.env.local', '.env.production']);
  expect(process.env[KEY]).toBe('');
});

test('the test server pins the key to empty for every command it runs', async () => {
  const source = await Bun.file(join(import.meta.dir, '../../scripts/test-server.ts')).text();
  expect(source).toContain(`childEnvironment.${KEY} = '';`);
});
