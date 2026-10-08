import { expect, test } from 'bun:test';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { assertAppPortFree } from './app-port';

function listen(): Promise<Server> {
  return new Promise((resolveListen, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

test('a build is refused while an application serves the port, naming the holders and the way out', async () => {
  const server = await listen();
  const { port } = server.address() as AddressInfo;
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
