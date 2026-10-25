import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

/** The main checkout serves the recorded build and `next dev` on Next's default port. */
const MAIN_CHECKOUT_PORT = 3000;
/** A linked worktree takes an even/odd port pair in 20000-29999, below every ephemeral range. */
const WORKTREE_PORT_BASE = 20_000;
const WORKTREE_PORT_PAIRS = 5_000;

/**
 * The ports of a checkout: `app` serves the recorded test build, `dev` serves
 * `next dev`. A linked worktree (its `.git` is a file) derives its pair from
 * its path, so parallel worktrees serve side by side; a collision of two
 * paths fails loudly at the port check below.
 */
export function workspacePorts(repositoryRoot: string): { app: number; dev: number } {
  if (!lstatSync(join(repositoryRoot, '.git')).isFile())
    return { app: MAIN_CHECKOUT_PORT, dev: MAIN_CHECKOUT_PORT };
  const digest = createHash('sha256').update(realpathSync(repositoryRoot)).digest();
  const app = WORKTREE_PORT_BASE + 2 * (digest.readUInt32BE(0) % WORKTREE_PORT_PAIRS);
  return { app, dev: app + 1 };
}

/** The origin the browser groups of this checkout open. */
export function workspaceAppOrigin(repositoryRoot: string): string {
  return `http://localhost:${workspacePorts(repositoryRoot).app}`;
}

function refusal(port: number): string {
  return [
    `Refused: port ${port} is serving an application, and a build would replace the .next files it serves.`,
    'It is the test server (bun run test:server), bun run start or bun run dev.',
    'Stop it first with Ctrl+C in its terminal, then build again.',
    `If you cannot find its terminal, ${process.platform === 'darwin' ? `lsof -nP -iTCP:${port} -sTCP:LISTEN` : `ss -ltnp 'sport = :${port}'`} names its process.`,
  ].join(' ');
}

const NOTHING_LISTENS = new Set(['ECONNREFUSED', 'EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENETUNREACH']);

function probe(host: string, port: number): Promise<void> {
  return new Promise<void>((resolveProbe, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(2_000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(refusal(port)));
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      // Refused, or a loopback family this host does not provide: nothing listens there.
      if (NOTHING_LISTENS.has(error.code ?? '')) resolveProbe();
      else reject(new Error(`Cannot verify that port ${port} is free: ${error.code}`));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Port ${port} ownership check timed out. Inspect the server before building.`));
    });
  });
}

/**
 * A running `next start` keeps reading .next after startup, and the test
 * server holds the workspace lock only while it prepares. Every local
 * production build therefore refuses while anything listens on the app port.
 */
export async function assertAppPortFree(port: number): Promise<void> {
  for (const host of ['127.0.0.1', '::1']) await probe(host, port);
}
