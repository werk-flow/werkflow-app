import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  createHealthHandler,
  HEALTH_CHECK_TOKEN_HEADER,
  type HealthDependencies,
} from '../../supabase/functions/health/handler';

// The edge functions (docs/technical/environments.md#credentials). The deploy
// steps turn JWT verification off by name, so every named function must check
// its own caller, and a new function deploys only once someone names it. The
// health function answers like a missing one without its token, and its
// report names checks, never a value or a provider body.

const repositoryRoot = resolve(import.meta.dir, '../..');
const DEPLOY_WORKFLOWS = ['.github/workflows/staging.yml', '.github/workflows/release.yml'];
// The guard each function's handler calls before it acts: the secret-key check or the health token.
const CALLER_GUARDS = ['createMailAuthorizer', 'hasToken('];

function functionFolders(): string[] {
  return readdirSync(resolve(repositoryRoot, 'supabase/functions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

function deployedFunctions(workflow: string): string[] {
  const text = readFileSync(resolve(repositoryRoot, workflow), 'utf8');
  const names = /supabase functions deploy ((?:[a-z0-9][a-z0-9-]* )+)--/.exec(text)?.[1];
  return (names ?? '').trim().split(/\s+/).filter(Boolean).sort();
}

test('each deploy step names every function, and every function checks its own caller', () => {
  for (const workflow of DEPLOY_WORKFLOWS) {
    expect(deployedFunctions(workflow), workflow).toEqual(functionFolders());
  }
  for (const name of functionFolders()) {
    const handler = readFileSync(resolve(repositoryRoot, `supabase/functions/${name}/handler.ts`), 'utf8');
    expect(
      CALLER_GUARDS.some((guard) => handler.includes(guard)),
      `${name} deploys without JWT verification, so its handler must check its caller`,
    ).toBe(true);
  }
});

// A remote module (jsr:, npm:, https:) is fetched when the runtime first boots the function: an
// unpinned supply-chain input, and on a fresh CI runner a registry stall hung the stack start
// (werk-flow/werkflow-planning#12). The functions import only their own relative modules.
test('every edge function module imports only relative modules', () => {
  const functionsRoot = resolve(repositoryRoot, 'supabase/functions');
  const remote = readdirSync(functionsRoot, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .flatMap((path) =>
      ts
        .preProcessFile(readFileSync(resolve(functionsRoot, path), 'utf8'), true, true)
        .importedFiles.filter(({ fileName }) => !fileName.startsWith('./') && !fileName.startsWith('../'))
        .map(({ fileName }) => `${path}: ${fileName}`),
    );
  expect(remote).toEqual([]);
});

const token = 'synthetic-health-token-0123456789abcdef';
const resendKey = 're_synthetic_private_key';
const providerBody = { statusCode: 400, message: 'private provider detail', name: 'validation_error' };
const unknownFunctionBody = { code: 'NOT_FOUND', message: 'Requested function was not found' };

function healthRequest(headers: Record<string, string> = { [HEALTH_CHECK_TOKEN_HEADER]: token }): Request {
  return new Request('https://example.test/functions/v1/health', { headers });
}

function handler(overrides: Partial<HealthDependencies> = {}, logs: unknown[] = []) {
  return createHealthHandler({
    healthCheckToken: token,
    resendApiKey: resendKey,
    fromEmail: 'WerkFlow <noreply@example.test>',
    secretKeys: JSON.stringify({ default: 'sb_secret_synthetic' }),
    sendRequest: async () => Response.json([]),
    logError: (...values) => logs.push(values),
    ...overrides,
  });
}

test('without a valid token the function answers like a missing one and calls no provider', async () => {
  const calls: string[] = [];
  const sendRequest = async (url: string) => {
    calls.push(url);
    return Response.json([]);
  };
  for (const [request, configured] of [
    [healthRequest({}), token],
    [healthRequest({ [HEALTH_CHECK_TOKEN_HEADER]: `${token}x` }), token],
    [healthRequest({ [HEALTH_CHECK_TOKEN_HEADER]: 'short' }), 'short'],
    [healthRequest(), undefined],
    [
      new Request('https://example.test/functions/v1/health', {
        method: 'POST',
        headers: { [HEALTH_CHECK_TOKEN_HEADER]: token },
      }),
      token,
    ],
  ] as const) {
    const response = await handler({ healthCheckToken: configured, sendRequest })(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(unknownFunctionBody);
  }
  expect(calls).toEqual([]);
});

test('a valid token gets every check, and a send-only key counts as valid', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  for (const answer of [
    () => Response.json({ data: [] }),
    () =>
      Response.json({ statusCode: 401, message: 'restricted', name: 'restricted_api_key' }, { status: 401 }),
  ]) {
    const response = await handler({
      sendRequest: async (url, init) => {
        calls.push({ url, authorization: new Headers(init.headers).get('Authorization') });
        return answer();
      },
    })(healthRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      checks: { resend_api_key: 'ok', from_email: 'ok', supabase_secret_keys: 'ok' },
    });
  }
  expect(calls).toEqual([
    { url: 'https://api.resend.com/domains', authorization: `Bearer ${resendKey}` },
    { url: 'https://api.resend.com/domains', authorization: `Bearer ${resendKey}` },
  ]);
});

test('a failing dependency is named, and neither the report nor the log carries its body', async () => {
  const cases: Array<{ overrides: Partial<HealthDependencies>; failed: string }> = [
    {
      overrides: { sendRequest: async () => Response.json(providerBody, { status: 400 }) },
      failed: 'resend_api_key',
    },
    {
      overrides: {
        sendRequest: async () => {
          throw new TypeError(`fetch failed ${resendKey}`);
        },
      },
      failed: 'resend_api_key',
    },
    { overrides: { resendApiKey: '' }, failed: 'resend_api_key' },
    { overrides: { fromEmail: undefined }, failed: 'from_email' },
    { overrides: { secretKeys: '[]' }, failed: 'supabase_secret_keys' },
  ];
  for (const { overrides, failed } of cases) {
    const logs: unknown[] = [];
    const response = await handler(overrides, logs)(healthRequest());
    expect(response.status).toBe(503);
    const text = await response.text();
    const checks = { resend_api_key: 'ok', from_email: 'ok', supabase_secret_keys: 'ok', [failed]: 'failed' };
    expect(JSON.parse(text)).toEqual({ ok: false, checks });
    for (const leaked of [text, JSON.stringify(logs)]) {
      expect(leaked).not.toContain('private provider detail');
      expect(leaked).not.toContain(resendKey);
    }
  }
});
