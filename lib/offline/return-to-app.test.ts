import { afterEach, expect, setSystemTime, test } from 'bun:test';

import { returnsOnStart } from '@/app/offline/return-to-app';

// Rule test: the offline page's start reloads on its own only while its loop guard can be written.
// A full sessionStorage can still read a missing guard while every write throws; a start that
// reloaded then would come back and reload again without the pause (CodeRabbit on #487).

const RELOADED_AT_KEY = 'werkflow:offline-reloaded-at';

function fakeStorage(writable: boolean): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => {
      if (!writable) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      values.set(key, value);
    },
  };
}

function onPhone(storage: Storage): void {
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
}

const original = { sessionStorage: globalThis.sessionStorage, navigator: globalThis.navigator };
afterEach(() => {
  setSystemTime();
  Object.defineProperty(globalThis, 'sessionStorage', { value: original.sessionStorage, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: original.navigator, configurable: true });
});

test('a start with a writable guard and no recent reload tries the way back', () => {
  onPhone(fakeStorage(true));
  expect(returnsOnStart()).toBe(true);
});

test('a start right after a reload that came back here waits', () => {
  const reloadedAt = new Date('2026-11-14T20:00:00Z');
  setSystemTime(new Date(reloadedAt.getTime() + 10_000));
  const storage = fakeStorage(true);
  storage.setItem(RELOADED_AT_KEY, String(reloadedAt.getTime()));
  onPhone(storage);
  expect(returnsOnStart()).toBe(false);
});

test('a start whose guard cannot be written leaves the way back to the signal and a tap', () => {
  onPhone(fakeStorage(false));
  expect(returnsOnStart()).toBe(false);
});
