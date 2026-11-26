import { afterEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { temporaryDirectory } from '@/lib/testing/temporary-directory';

// The local test server replays recorded streams and must never call a paid
// model (werk-flow/werkflow-planning#530). scripts/test-server.ts pins
// WERKFLOW_KI_ANTHROPIC_KEY to empty for its build and server; Next's env
// loading never replaces a variable the process already has, so a key in the
// checkout's .env.local stays out.
const KEY = 'WERKFLOW_KI_ANTHROPIC_KEY';

/** The env loader of the installed Next, resolved from Next itself: the code `next build` and `next start` run. */
function nextEnvLoader(): (directory: string, dev: boolean, log: object, forceReload: boolean) => unknown {
  const fromNext = createRequire(Bun.resolveSync('next/package.json', import.meta.dir));
  const loaded: unknown = fromNext('@next/env');
  if (
    loaded &&
    typeof loaded === 'object' &&
    'loadEnvConfig' in loaded &&
    typeof loaded.loadEnvConfig === 'function'
  )
    return (...args) => Reflect.apply(loaded.loadEnvConfig, loaded, args);
  throw new Error('Next ships no loadEnvConfig');
}
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

test('an env file cannot override the test server’s empty model key', () => {
  const directory = temporaryDirectory('model-key-pin-');
  writeFileSync(join(directory, '.env.local'), `${KEY}=synthetic-key-from-a-file\n`);
  writeFileSync(join(directory, '.env.production'), `${KEY}=synthetic-key-from-a-file\n`);
  process.env[KEY] = '';
  nextEnvLoader()(directory, false, { info: () => undefined, error: () => undefined }, true);
  expect(process.env[KEY]).toBe('');
});

test('the test server pins the key to empty for every command it runs', async () => {
  const source = await Bun.file(join(import.meta.dir, '../../scripts/test-server.ts')).text();
  expect(source).toContain(`childEnvironment.${KEY} = '';`);
});
