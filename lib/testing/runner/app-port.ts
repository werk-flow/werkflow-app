import { createConnection } from 'node:net';

/** The port the test server serves the recorded build on; `next start` and `next dev` default to it. */
const APP_PORT = 3000;

function refusal(port: number): string {
  return [
    `Refused: port ${port} is serving an application, and a build would replace the .next files it serves.`,
    'It is the test server (bun run test:server), bun run start or bun run dev.',
    'Stop it first with Ctrl+C in its terminal, then build again.',
    `If you cannot find its terminal, Get-NetTCPConnection -LocalPort ${port} -State Listen names its process.`,
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
export async function assertAppPortFree(port = APP_PORT): Promise<void> {
  for (const host of ['127.0.0.1', '::1']) await probe(host, port);
}
