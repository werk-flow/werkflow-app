// Stand-in for `@/lib/field-sync/device/today-store` as the offline view
// reads it: every read waits until the spec answers it with a stored day or
// none, so a wipe in another tab can land between the read and its answer.
import type { StoredToday } from '@/lib/field-sync/device/today-store';

export type { StoredToday };
// The wipe signal is read as the product reads it; only the device read is held.
export { sharedWipeGeneration } from '@/lib/field-sync/device/today-store';

declare global {
  interface Window {
    offlineTodayContract: {
      reads: number;
      answer: (withDay: boolean) => void;
    };
  }
}

const pending: Array<(stored: StoredToday | null) => void> = [];

const storedDay: StoredToday = {
  snapshot: {
    version: 'v1',
    berlinDate: '2026-11-09',
    validUntil: '2999-01-01T00:00:00.000Z',
    userId: '9a000000-0000-4000-8000-000000000001',
    organizationId: '9a000000-0000-4000-8000-0000000000a1',
    assignments: [
      {
        jobId: '9a000000-0000-4000-8000-000000000021',
        jobNumber: 'AUF-2026-21',
        title: 'Heizung tauschen bei Familie Muster',
        requestedOutcome: null,
        plannedWorkingMinutes: null,
        visits: [{ startAt: null, endAt: null }],
        customerName: 'Familie Muster',
        customerPhone: null,
        siteName: null,
        siteAddress: 'Musterweg 1, 10115 Berlin',
        accessNotes: null,
        contactName: null,
        contactRole: null,
        contactPhone: null,
        project: null,
        instructions: [],
      },
    ],
  },
  confirmedAt: '2026-11-09T06:42:00.000Z',
  wipeGeneration: '',
};

window.offlineTodayContract = {
  reads: 0,
  answer(withDay): void {
    const resolve = pending.shift();
    if (!resolve) throw new Error('No pending device read.');
    resolve(withDay ? storedDay : null);
  },
};

export async function readTodayOnDevice(): Promise<StoredToday | null> {
  window.offlineTodayContract.reads += 1;
  return new Promise((resolve) => {
    pending.push(resolve);
  });
}
