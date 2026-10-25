import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { getAppListener, lsofField, ssProcessIds } from './app-listener';

test('reads the listening process ids of ss output', () => {
  expect(ssProcessIds('LISTEN 0 511 *:3000 *:* users:(("next-server (v1",pid=105082,fd=21))\n')).toEqual([
    '105082',
  ]);
  expect(ssProcessIds('')).toEqual([]);
});

test('reads one field of lsof output', () => {
  expect(lsofField('p123\nf4\nn/work/app\n', 'p')).toEqual(['123']);
  expect(lsofField('p123\nfcwd\nn/work/app\n', 'n')).toEqual(['/work/app']);
  expect(lsofField('', 'p')).toEqual([]);
});

test('names the process, working directory and start of a real listener, and null for a free port', async () => {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const listener = getAppListener(port);
    expect(listener?.processId).toBe(process.pid);
    expect(listener?.workingDirectory).toBe(process.cwd());
    expect(listener?.startedAt).toBeLessThanOrEqual(Date.now());
    expect(listener?.command).toContain('bun');
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
  expect(getAppListener(port)).toBeNull();
  expect(() => getAppListener(0)).toThrow('Invalid listener port');
});
