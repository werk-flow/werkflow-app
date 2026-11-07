import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  consumeManualEntryBridge,
  queueManualEntryBridge,
  readManualEntryEvent,
} from './manual-entry-bridge';
import { clearManualEntryBridge } from './manual-entry-bridge-storage';
import { toTimeEntry, type TimeEntryRow } from './types';

const row: TimeEntryRow = {
  capture_source: null,
  operation_id: null,
  recovery_reason: null,
  id: 'entry-1',
  user_id: 'user-1',
  organization_id: 'org-1',
  entry_type: 'clock_in',
  timestamp: '2026-11-05T08:00:00.000Z',
  is_manual: true,
  job_id: null,
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-11-05T08:00:00.000Z',
  updated_at: '2026-11-05T08:00:00.000Z',
};

describe('readManualEntryEvent', () => {
  test('keeps every field of an entry the manual entry button sends', () => {
    const entries = [toTimeEntry(row)];
    expect(readManualEntryEvent({ entries })).toEqual(entries);
  });

  test.each([[null], [{}], [{ entries: 'entry-1' }], [{ entries: [{ id: 'entry-1' }] }]])(
    'refuses a detail the button never sends: %j',
    (detail) => {
      expect(readManualEntryEvent(detail)).toBeNull();
    },
  );
});

/** The tab's session storage: what the bridge keeps between two pages of one tab. */
class TabStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('manual entry bridge queue', () => {
  let storage: TabStorage;

  beforeEach(() => {
    storage = new TabStorage();
    Object.defineProperty(globalThis, 'window', { value: { sessionStorage: storage }, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  const entry = toTimeEntry(row);
  // An admin queues an entry they added for an employee; the queue belongs to the admin.
  const queuedByAdmin = { userId: 'admin-1', organizationId: 'org-1' };

  test('the signed-in user reads their queued entries once', () => {
    queueManualEntryBridge('admin-1', [entry]);
    expect(consumeManualEntryBridge(queuedByAdmin)).toEqual([entry]);
    expect(consumeManualEntryBridge(queuedByAdmin)).toEqual([]);
  });

  test('a sign-out leaves no queued entry in the tab', () => {
    queueManualEntryBridge('admin-1', [entry]);
    clearManualEntryBridge();
    expect(storage.length).toBe(0);
    expect(consumeManualEntryBridge(queuedByAdmin)).toEqual([]);
  });

  test('another user signed in to the same tab never reads the queue, and it is dropped', () => {
    queueManualEntryBridge('admin-1', [entry]);
    expect(consumeManualEntryBridge({ userId: 'user-1', organizationId: 'org-1' })).toEqual([]);
    expect(storage.length).toBe(0);
    expect(consumeManualEntryBridge(queuedByAdmin)).toEqual([]);
  });

  test('a new queue of another user replaces the old one instead of joining it', () => {
    queueManualEntryBridge('admin-1', [entry]);
    const own = toTimeEntry({ ...row, id: 'entry-2' });
    queueManualEntryBridge('user-1', [own]);
    expect(consumeManualEntryBridge({ userId: 'user-1', organizationId: 'org-1' })).toEqual([own]);
  });

  test('another organization of the same user leaves the queue for its own organization', () => {
    queueManualEntryBridge('admin-1', [entry]);
    expect(consumeManualEntryBridge({ userId: 'admin-1', organizationId: 'org-2' })).toEqual([]);
    expect(consumeManualEntryBridge(queuedByAdmin)).toEqual([entry]);
  });

  test('a stored queue without its user is dropped unread', () => {
    storage.setItem('werkflow:manual-entry-created', JSON.stringify([entry]));
    expect(consumeManualEntryBridge(queuedByAdmin)).toEqual([]);
    expect(storage.length).toBe(0);
  });
});

describe('manual entry bridge without tab storage', () => {
  beforeEach(() => {
    const refusingWindow = {};
    Object.defineProperty(refusingWindow, 'sessionStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    Object.defineProperty(globalThis, 'window', { value: refusingWindow, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  test('a browser that refuses session storage never stops a sign-out, a queue or a read', () => {
    expect(() => clearManualEntryBridge()).not.toThrow();
    expect(() => queueManualEntryBridge('admin-1', [toTimeEntry(row)])).not.toThrow();
    expect(consumeManualEntryBridge({ userId: 'admin-1', organizationId: 'org-1' })).toEqual([]);
  });
});
