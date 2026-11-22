// A browser job's test server (scripts/ci/job.ts) is stopped with every process it started, and its
// port proven free, before the job returns: a runner that reuses the host starts the next job there.
import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { assertAppPortFree } from '../runner/app-port';
import { stopTestServer } from './test-server-stop';

const SESSION = join(import.meta.dir, '../local-stack/test-session.ts');
const leftovers: number[] = [];

afterEach(() => {
  for (const groupId of leftovers.splice(0)) {
    try {
      process.kill(-groupId, 'SIGKILL');
    } catch {
      // The group already ended.
    }
  }
});

function groupListed(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  if (address === null || typeof address === 'string') throw new Error('No TCP port was assigned.');
  return address.port;
}

/** Prints its pid, which leads its own group, once it holds the port. */
const listener = (port: number): string =>
  `require('node:net').createServer().listen(${port}, () => console.log(process.pid));`;

/**
 * Starts a fake test server as its own group, like job.ts does, and resolves once the listener it
 * started in a group of its own holds the port.
 */
async function startServer(source: string): Promise<{ server: number; listener: number }> {
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });
  const server = child.pid;
  if (server === undefined) throw new Error('The fake test server did not start.');
  leftovers.push(server);
  const listening = await new Promise<number>((resolveListening, reject) => {
    child.stdout.once('data', (chunk: Buffer) => resolveListening(Number(chunk.toString())));
    child.once('exit', (code) => reject(new Error(`The fake test server exited ${code}.`)));
  });
  leftovers.push(listening);
  return { server, listener: listening };
}

test('a stopped test server takes the commands it started in their own groups with it, and frees its port', async () => {
  const port = await freePort();
  // The real test session (scripts/test-server.ts): its command leads its own group, which the
  // server's SIGTERM never reaches directly.
  const groups = await startServer(`
    const { runSessionCommand, withTestSession } = require(${JSON.stringify(SESSION)});
    await withTestSession((signal) => runSessionCommand([process.execPath, '-e', ${JSON.stringify(listener(port))}], { signal }));
  `);
  await stopTestServer(groups.server, port);
  expect([groupListed(groups.server), groupListed(groups.listener)]).toEqual([false, false]);
  await expect(assertAppPortFree(port)).resolves.toBeUndefined();
});

test('a stop that leaves the port held fails and names the port', async () => {
  const port = await freePort();
  // A server that forgets its child: the listener's group outlives the server's.
  const groups = await startServer(`
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(listener(port))}], { stdio: ['ignore', 'inherit', 'ignore'], detached: true });
    setInterval(() => {}, 1000);
  `);
  await expect(stopTestServer(groups.server, port)).rejects.toThrow(`Port ${port} is still held`);
  expect(groupListed(groups.server)).toBe(false);
});
