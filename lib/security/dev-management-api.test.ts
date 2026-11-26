// Rule test: a DEV script never prints its token, even when Bun's fetch tracing is switched on in
// the environment (BUN_CONFIG_VERBOSE_FETCH), which prints every request header. The token here
// is made up, and every request goes to a loopback server.
import { afterAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const SYNTHETIC = `sbp_${'5e'.repeat(20)}`;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) =>
    request.method === 'POST' ? Response.json([], { status: 201 }) : Response.json({}, { status: 200 }),
});
afterAll(() => server.stop(true));

/** Runs `script` in a Bun with tracing on, and returns everything it printed. */
async function traced(script: string): Promise<string> {
  // Not spawnSync: the loopback server answers on this process's event loop.
  const child = Bun.spawn({
    cmd: [process.execPath, '--no-env-file', '-e', script],
    cwd: resolve(import.meta.dir, '../..'),
    env: {
      ...process.env,
      BUN_CONFIG_VERBOSE_FETCH: 'curl',
      SUPABASE_ACCESS_TOKEN: SYNTHETIC,
      LOOPBACK: server.url.href,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const output = `${stdout}${stderr}`;
  if (exitCode !== 0) throw new Error(`The traced script failed: ${output}`);
  return output;
}

test('tracing would print the bearer, so the check below can see a leak', async () => {
  const output = await traced(
    `await fetch(process.env.LOOPBACK, { headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN } });`,
  );
  expect(output).toContain(SYNTHETIC);
});

test("neither DEV request prints the token, with Bun's fetch tracing on", async () => {
  const output = await traced(`
    import { queryDevReadOnly, readDevProject } from './lib/security/dev-management-api';
    // The real fetch with the module's own options; only the address moves to loopback.
    const loopback: typeof fetch = Object.assign(
      (url: string | URL | Request, init?: RequestInit) =>
        fetch(new URL(new URL(String(url)).pathname, process.env.LOOPBACK), init),
      { preconnect: fetch.preconnect },
    );
    await readDevProject('config/auth', loopback);
    await queryDevReadOnly('probe', 'select 1', loopback);
    console.log('both requests ran');
  `);
  expect(output).toContain('both requests ran');
  expect(output).not.toContain(SYNTHETIC);
});
