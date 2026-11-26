// Rule test: the agents' DEV Supabase MCP server starts only on DEV, read-only, on the machine's
// agent token, which reaches the server only in its environment. Every value here is made up.
import { expect, test } from 'bun:test';

import { devMcpLaunch } from './supabase-dev-mcp';

const refs = { production: 'prodprodprodprodprod', dev: 'devdevdevdevdevdevde' };
const token = `sbp_${'0a'.repeat(20)}`;
const launch = (args: readonly string[], given: Partial<Parameters<typeof devMcpLaunch>[0]> = {}) =>
  devMcpLaunch({ args, refs, token, serverEntry: '/pinned/cli.js', env: { PATH: '/bin' }, ...given });

test('the server starts on DEV in read-only mode, with the token only in its environment', () => {
  const started = launch([`--project-ref=${refs.dev}`]);
  if ('refusal' in started) throw new Error(started.refusal);
  expect(started.args).toEqual([
    '--no-env-file',
    '/pinned/cli.js',
    `--project-ref=${refs.dev}`,
    '--read-only',
  ]);
  expect(started.args.join(' ')).not.toContain(token);
  expect(started.env).toEqual({ PATH: '/bin', SUPABASE_ACCESS_TOKEN: token });
});

test('the server inherits only what it needs to run: no other credential, no setting that logs headers', () => {
  const started = launch([`--project-ref=${refs.dev}`], {
    env: {
      PATH: '/bin',
      HTTPS_PROXY: 'http://proxy.test:3128',
      SUPABASE_ACCESS_TOKEN: 'sbp_account_wide',
      SUPABASE_SECRET_KEY: 'sb_secret_made_up',
      BUN_CONFIG_VERBOSE_FETCH: 'curl',
      NODE_OPTIONS: '--require ./hook.js',
    },
  });
  if ('refusal' in started) throw new Error(started.refusal);
  expect(started.env).toEqual({
    PATH: '/bin',
    HTTPS_PROXY: 'http://proxy.test:3128',
    SUPABASE_ACCESS_TOKEN: token,
  });
  // Bun reads no .env file from the agent's working directory.
  expect(started.args[0]).toBe('--no-env-file');
});

test("PROD's ref, another ref, extra arguments or no ref refuse the start", () => {
  expect(launch([`--project-ref=${refs.production}`])).toEqual({
    refusal: 'The ref names PROD. The agent MCP server reaches DEV only.',
  });
  for (const args of [
    ['--project-ref=otherotherotherother'],
    [],
    [`--project-ref=${refs.dev}`, '--features=account'],
    [`--project-ref=${refs.dev}`, '--read-only=false'],
    ['--project-ref', refs.dev],
  ])
    expect('refusal' in launch(args), args.join(' ')).toBe(true);
});

test('without the refs from the environments doc or the agent token, nothing starts', () => {
  expect(launch([`--project-ref=${refs.dev}`], { refs: undefined })).toHaveProperty('refusal');
  const missing = launch([`--project-ref=${refs.dev}`], { token: undefined });
  expect(missing).toHaveProperty('refusal');
  expect(JSON.stringify(missing)).toContain('agent-access:check');
});
