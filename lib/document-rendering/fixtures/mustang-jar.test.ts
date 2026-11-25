// A pinned file is used only with its pinned SHA-256, a kept one costs no download, and a busy
// mirror is retried (mustang-jar.ts).
import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pinnedFile } from './mustang-jar';

const JAR = new TextEncoder().encode('the pinned jar');
const URL = 'https://mirror.test/Mustang-CLI.jar';
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function pinIn(): { url: string; sha256: string; path: string } {
  const folder = mkdtempSync(join(tmpdir(), 'mustang-jar-'));
  folders.push(folder);
  return {
    url: URL,
    sha256: createHash('sha256').update(JAR).digest('hex'),
    path: join(folder, 'cache/jar'),
  };
}

/** A network that answers each fetch with the next status, the pinned bytes on a 200. */
function network(statuses: number[], body: Uint8Array<ArrayBuffer> = JAR) {
  const fetched: string[] = [];
  const waited: number[] = [];
  return {
    fetched,
    waited,
    fetch: async (url: string): Promise<Response> => {
      fetched.push(url);
      const status = statuses[fetched.length - 1];
      if (status === undefined) throw new Error('fetched more often than the test allows');
      return new Response(status === 200 ? body : null, { status });
    },
    wait: async (ms: number): Promise<void> => void waited.push(ms),
  };
}

test('a download whose SHA-256 differs from the pin is refused and never kept', async () => {
  const pin = pinIn();
  await expect(pinnedFile(pin, network([200], new TextEncoder().encode('a tampered jar')))).rejects.toThrow(
    'not the pinned',
  );
  expect(() => readFileSync(pin.path)).toThrow();
});

test('a tampered kept file is replaced by a verified download, never used', async () => {
  const pin = pinIn();
  mkdirSync(dirname(pin.path), { recursive: true });
  writeFileSync(pin.path, 'a tampered jar');
  const mirror = network([200]);
  expect(await pinnedFile(pin, mirror)).toBe(pin.path);
  expect(mirror.fetched).toEqual([URL]);
  expect(readFileSync(pin.path)).toEqual(Buffer.from(JAR));
});

test('a kept file with the pinned SHA-256 is used without a network call', async () => {
  const pin = pinIn();
  mkdirSync(dirname(pin.path), { recursive: true });
  writeFileSync(pin.path, JAR);
  const mirror = network([]);
  expect(await pinnedFile(pin, mirror)).toBe(pin.path);
  expect(mirror.fetched).toEqual([]);
});

test('a 429 and then a 200 yields the verified file after one wait', async () => {
  const pin = pinIn();
  const mirror = network([429, 200]);
  expect(await pinnedFile(pin, mirror)).toBe(pin.path);
  expect(mirror.fetched).toEqual([URL, URL]);
  expect(mirror.waited).toEqual([5_000]);
  expect(readFileSync(pin.path)).toEqual(Buffer.from(JAR));
});

test('a mirror busy beyond the retry budget fails with its last answer, after a bounded wait', async () => {
  const pin = pinIn();
  const mirror = network([429, 429, 429, 429]);
  await expect(pinnedFile(pin, mirror)).rejects.toThrow(`${URL} answered 429.`);
  expect(mirror.fetched).toHaveLength(4);
  expect(mirror.waited.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(2 * 60_000);
});

test('a refusal that is not busy fails at once', async () => {
  const mirror = network([404]);
  await expect(pinnedFile(pinIn(), mirror)).rejects.toThrow('answered 404.');
  expect(mirror.waited).toEqual([]);
});
