// A browser job's test server (scripts/ci/job.ts) is stopped with every process it started, and its
// port proven free, before the job returns: a runner that reuses the host starts the next job there.
import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { getListenerGroup } from '../runner/app-listener';
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

/** Prints its pid, which leads its own group, and the port the system assigned it, once it holds it. */
const LISTENER = `const server = require('node:net').createServer().listen(0, () => console.log(process.pid + ' ' + server.address().port));`;

/** A port the system assigned and released again. */
async function unusedPort(): Promise<number> {
  const free = createServer();
  const port = await new Promise<number>((resolvePort) =>
    free.listen(0, () => {
      const address = free.address();
      resolvePort(typeof address === 'object' && address !== null ? address.port : 0);
    }),
  );
  await new Promise((resolveClose) => free.close(resolveClose));
  return port;
}

/**
 * Starts a fake test server as its own group, like job.ts does, and resolves once the listener it
 * started in a group of its own holds the port.
 */
async function startServer(source: string): Promise<{ server: number; listener: number; port: number }> {
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });
  const server = child.pid;
  if (server === undefined) throw new Error('The fake test server did not start.');
  leftovers.push(server);
  const [listening, port] = await new Promise<number[]>((resolveListening, reject) => {
    child.stdout.once('data', (chunk: Buffer) => resolveListening(chunk.toString().split(' ').map(Number)));
    child.once('exit', (code) => reject(new Error(`The fake test server exited ${code}.`)));
  });
  if (listening === undefined || port === undefined) throw new Error('The fake listener reported no port.');
  leftovers.push(listening);
  return { server, listener: listening, port };
}

test('a stopped test server takes the commands it started in their own groups with it, and frees its port', async () => {
  // The real test session (scripts/test-server.ts): its command leads its own group, which the
  // server's SIGTERM never reaches directly.
  const groups = await startServer(`
    const { runSessionCommand, withTestSession } = require(${JSON.stringify(SESSION)});
    await withTestSession((signal) => runSessionCommand([process.execPath, '-e', ${JSON.stringify(LISTENER)}], { signal }));
  `);
  const { port } = groups;
  await stopTestServer(groups.server, port, undefined);
  expect([groupListed(groups.server), groupListed(groups.listener)]).toEqual([false, false]);
  await expect(assertAppPortFree(port)).resolves.toBeUndefined();
});

test('a stop waits for a descendant that releases the port shortly after the server group ended', async () => {
  // A listener in a group of its own that closes its port half a second after the server died, as
  // a descendant the test session stops can still be closing its socket.
  const releasing = `const parent = process.ppid; const watch = setInterval(() => { if (process.ppid !== parent) { clearInterval(watch); setTimeout(() => process.exit(0), 500); } }, 20); ${LISTENER}`;
  const groups = await startServer(`
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(releasing)}], { stdio: ['ignore', 'inherit', 'ignore'], detached: true });
    setInterval(() => {}, 1000);
  `);
  await stopTestServer(groups.server, groups.port, undefined);
  await expect(assertAppPortFree(groups.port)).resolves.toBeUndefined();
});

test('a stop that leaves the port held fails and names the port', async () => {
  // A server that forgets its child: the listener's group outlives the server's.
  const groups = await startServer(`
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(LISTENER)}], { stdio: ['ignore', 'inherit', 'ignore'], detached: true });
    setInterval(() => {}, 1000);
  `);
  const { port } = groups;
  const stopped = stopTestServer(groups.server, port, undefined);
  await expect(stopped).rejects.toThrow(`Port ${port} is still held`);
  // The message names the process still holding the port, so the next reader finds it.
  await expect(stopped).rejects.toThrow(`pid ${groups.listener}, pgid ${groups.listener}, command `);
  await expect(stopped).rejects.toThrow('createServer');
  expect(groupListed(groups.server)).toBe(false);
});

test('a server that missed its own cancellation loses the listener group recorded at readiness', async () => {
  // As on the Mac's shard 3: the server exits on SIGTERM without stopping the listener it started
  // in a group of its own (runSessionCommand), which would keep holding the port.
  const groups = await startServer(`
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(LISTENER)}], { stdio: ['ignore', 'inherit', 'ignore'], detached: true });
    setInterval(() => {}, 1000);
  `);
  const listener = getListenerGroup(groups.port);
  expect(listener?.groupId).toBe(groups.listener);
  await stopTestServer(groups.server, groups.port, listener ?? undefined);
  expect([groupListed(groups.server), groupListed(groups.listener)]).toEqual([false, false]);
  await expect(assertAppPortFree(groups.port)).resolves.toBeUndefined();
});

test('a recorded listener group whose leader started at another time is never signalled', async () => {
  // A group id the system handed to another process since the recording: here a sentinel this test owns.
  const sentinel = await startServer(LISTENER);
  const recorded = getListenerGroup(sentinel.port);
  expect(recorded?.groupId).toBe(sentinel.server);
  const freePort = await unusedPort();
  const signals: (string | number | undefined)[] = [];
  const kill = process.kill.bind(process);
  const watched = spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (pid === -sentinel.server) signals.push(signal);
    return kill(pid, signal);
  });
  try {
    await stopTestServer(undefined, freePort, {
      groupId: sentinel.server,
      leaderStart: `${recorded?.leaderStart}0`,
    });
  } finally {
    watched.mockRestore();
  }
  expect(signals.filter((signal) => signal !== 0)).toEqual([]);
  expect(groupListed(sentinel.server)).toBe(true);
});

test('a server whose group already ended is never signalled', async () => {
  const exited = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', detached: true });
  const groupId = exited.pid;
  if (groupId === undefined) throw new Error('The fake test server did not start.');
  await new Promise((resolveExit) => exited.once('exit', resolveExit));
  const port = await unusedPort();
  const signals: (string | number | undefined)[] = [];
  const kill = process.kill.bind(process);
  const watched = spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (pid === -groupId) signals.push(signal);
    return kill(pid, signal);
  });
  try {
    await stopTestServer(groupId, port, undefined);
  } finally {
    watched.mockRestore();
  }
  expect(signals.filter((signal) => signal !== 0)).toEqual([]);
});
