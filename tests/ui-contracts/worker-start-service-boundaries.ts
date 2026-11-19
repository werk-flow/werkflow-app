// Stand-ins for what the field worker's start page reads
// (components/dashboard/worker-start-*): the phone's stored day and its saved
// signal (E7's seam), the clock state and the attention counts the app layout
// holds. The spec sets each through `window.workerStartContract`.
import { useSyncExternalStore } from 'react';

import type { AttentionCounts } from '@/lib/attention/types';
import type { StoredToday } from '@/lib/field-sync/device/today-store';
import type { LiveClockState } from '@/lib/time-tracking/types';

type Scope = { userId: string; organizationId: string; role: 'employee' | 'buero' };

type ClockView = {
  state: LiveClockState | null;
  /** The server's last confirmed clock; without one, the state itself, as when nothing was echoed. */
  confirmed?: LiveClockState | null;
  isReady: boolean;
  statusError: string | null;
};

/** What the next device read answers: a stored day, none, or a failed storage. */
type DeviceAnswer = { stored: StoredToday | null } | { fails: true };

declare global {
  interface Window {
    /** What the device answers from the first read on; set before the bundle loads. */
    workerStartDevice?: DeviceAnswer;
    workerStartContract: {
      reads: number;
      device: DeviceAnswer;
      /** A refresh of the start page saved a day: every `onTodaySaved` listener hears it. */
      save: (stored: StoredToday | null) => void;
      /** Tells every `onTodaySaved` listener without changing what the device answers. */
      notifySaved: () => void;
      setClock: (clock: ClockView) => void;
      setActionableCount: (count: number) => void;
      /** The person and organization the tab's client contexts hold. */
      setScope: (scope: Scope) => void;
    };
  }
}

const savedListeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
let clock: ClockView = { state: null, isReady: false, statusError: null };
let scope: Scope = {
  userId: '9b000000-0000-4000-8000-000000000001',
  organizationId: '9b000000-0000-4000-8000-0000000000a1',
  role: 'employee',
};
let counts: AttentionCounts = { actionableCount: 0, approvalsCount: 0, unreadNotificationCount: 0 };

function changed(): void {
  for (const listener of changeListeners) listener();
}

window.workerStartContract = {
  reads: 0,
  device: window.workerStartDevice ?? { stored: null },
  save(stored) {
    window.workerStartContract.device = { stored };
    window.workerStartContract.notifySaved();
  },
  notifySaved() {
    for (const listener of savedListeners) listener();
  },
  setClock(next) {
    clock = next;
    changed();
  },
  setScope(next) {
    scope = next;
    changed();
  },
  setActionableCount(count) {
    counts = { ...counts, actionableCount: count };
    changed();
  },
};

export async function readTodayOnDevice(): Promise<StoredToday | null> {
  window.workerStartContract.reads += 1;
  const answer = window.workerStartContract.device;
  if ('fails' in answer)
    throw new DOMException('The operation failed for reasons unrelated to the database.');
  return answer.stored;
}

export function onTodaySaved(listener: () => void): () => void {
  const entry = (): void => listener();
  savedListeners.add(entry);
  return () => {
    savedListeners.delete(entry);
  };
}

function subscribe(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function useClockState(): ClockView & { confirmed: LiveClockState | null } {
  const current = useSyncExternalStore(subscribe, () => clock);
  return { ...current, confirmed: current.confirmed ?? current.state };
}

export function useAttentionCounts(): AttentionCounts {
  return useSyncExternalStore(subscribe, () => counts);
}

/** E7's refresh of the stored day; the spec saves the day through `window.workerStartContract.save`. */
export function TodayRefreshOnStart(): null {
  return null;
}

export function useUserProfile(): { profile: { id: string } } {
  return { profile: { id: useSyncExternalStore(subscribe, () => scope).userId } };
}

export function useOrganization(): { activeOrg: { orgId: string; role: Scope['role'] } } {
  const current = useSyncExternalStore(subscribe, () => scope);
  return { activeOrg: { orgId: current.organizationId, role: current.role } };
}
