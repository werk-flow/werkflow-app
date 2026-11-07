import { expect, jest, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAppPortFree, workspaceAppOrigin, workspacePorts } from './app-port';

function listen(host: string, port = 0): Promise<Server> {
  return new Promise((resolveListen, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen({ host, port }, () => resolveListen(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('The test server listens on a TCP port.');
  return address.port;
}

/** A port nothing listens on, in either family. */
async function closedPort(): Promise<number> {
  const server = await listen('::');
  const port = portOf(server);
  await close(server);
  return port;
}

for (const host of ['127.0.0.1', '::1', '0.0.0.0', '::'])
  test(`a build is refused while an application serves the port on ${host}, naming the holders and the way out`, async () => {
    const server = await listen(host, await closedPort());
    const port = portOf(server);
    try {
      const refusal = assertAppPortFree(port);
      await expect(refusal).rejects.toThrow(`Refused: port ${port} is serving an application`);
      await expect(refusal).rejects.toThrow('bun run test:server');
      await expect(refusal).rejects.toThrow('Stop it first with Ctrl+C');
    } finally {
      await close(server);
    }
    await expect(assertAppPortFree(port)).resolves.toBeUndefined();
  });

test('a free port reads as free even when a stall lets every clock run out before the kernel answers', async () => {
  const port = await closedPort();
  jest.useFakeTimers();
  try {
    const check = assertAppPortFree(port);
    jest.runAllTimers();
    await expect(check).resolves.toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

test('the main checkout keeps the default port and each linked worktree derives its own pair from its path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-ports-'));
  try {
    const main = join(directory, 'main');
    mkdirSync(join(main, '.git'), { recursive: true });
    const worktrees = ['one', 'two'].map((name) => {
      const root = join(directory, name);
      mkdirSync(root);
      writeFileSync(join(root, '.git'), `gitdir: ${main}/.git/worktrees/${name}\n`);
      return root;
    });
    expect(workspacePorts(main)).toEqual({ app: 3000, dev: 3000 });
    expect(workspaceAppOrigin(main)).toBe('http://localhost:3000');
    const [one, two] = worktrees.map((root) => workspacePorts(root));
    for (const ports of [one, two]) {
      expect(ports?.app).toBeGreaterThanOrEqual(20_000);
      expect(ports?.dev).toBe((ports?.app ?? 0) + 1);
      expect(ports?.dev).toBeLessThan(30_000);
    }
    expect(one?.app).not.toBe(two?.app);
    expect(workspacePorts(worktrees[0] ?? '')).toEqual(one ?? { app: 0, dev: 0 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
