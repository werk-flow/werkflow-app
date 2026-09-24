import { createContext, useContext } from "react";
import type { CalendarWindowInput, CalendarWindowResult } from "@/lib/calendar/actions";
import type { CalendarBoardResult } from "@/lib/calendar/board-actions";
import type { CalendarJob } from "@/lib/jobs/types";
import type { RealtimeTable } from "@/lib/realtime/tables";

export const CalendarOrganizationContext = createContext("org-a");
export function useOrganization(): { activeOrgId: string } {
  return { activeOrgId: useContext(CalendarOrganizationContext) };
}
export function useUserProfile() { return { profile: { id: 'contract-caller' } }; }
export function contractJob(title: string): CalendarJob {
  return { id: title, title, jobNumber: null, status: "nicht_bearbeitet", priority: "mittel",
    plannedDate: "2026-09-08", plannedTime: null, estimatedDurationMinutes: null,
    plannedWorkingMinutes: null, location: null, clientName: null, clientAddress: null,
    projectName: null, projectNumber: null, assignedUserIds: [] };
}
type PendingRead = { input: CalendarWindowInput; resolve: (result: CalendarWindowResult) => void };
type Channel = { status?: ((status: string) => void) | undefined; system?: ((payload: unknown) => void) | undefined; listeners: Array<{ table: string; callback: (payload: unknown) => void }> };
const reads: PendingRead[] = [];
const channels: Channel[] = [];
declare global {
  interface Window {
    calendarContract: {
      reads: CalendarWindowInput[];
      resolveRead: (index: number, label: string, success?: boolean, closureLabel?: string) => void;
      status: (status: string) => void;
      system: (payload: unknown) => void;
      captureLateDelivery: () => () => void;
      emit: (table?: RealtimeTable) => void;
    };
  }
}
window.calendarContract = {
  reads: [],
  resolveRead(index, label, success = true, closureLabel) {
    const pending = reads[index];
    if (!pending) throw new Error(`No held calendar read ${index}.`);
    pending.resolve(success ? { success: true, entries: [], jobs: [contractJob(label)], vacation: [], sickness: [], holidays: { holidayRegion: null, holidayRegionHistory: [], closureDays: closureLabel ? [{ id: "closure", closureDate: "2026-09-08", label: closureLabel }] : [] }, changeRequestMap: {} }
      : { success: false, error: "held_failure" });
  },
  status(status) { for (const channel of channels) channel.status?.(status); },
  system(payload) { for (const channel of channels) channel.system?.(payload); },
  captureLateDelivery() {
    const channel = channels.at(-1);
    if (!channel) throw new Error('Missing channel');
    const callbacks = channel.listeners.filter(listener => ['jobs', 'clients', 'realtime_deletions'].includes(listener.table));
    const system = channel.system;
    return () => {
      system?.({ extension: 'postgres_changes', status: 'ok' });
      for (const listener of callbacks) listener.callback({ eventType: 'INSERT', new: {
        id: 'late', table_name: 'clients', organization_id: 'org-a', row_id: '11111111-1111-4111-8111-111111111111',
      }, old: {}, commit_timestamp: new Date().toISOString() });
    };
  },
  emit(table = "jobs") {
    for (const channel of channels) for (const listener of channel.listeners) {
      if (listener.table === table) listener.callback({ eventType: "UPDATE", new: { id: "changed" }, old: {}, commit_timestamp: new Date().toISOString() });
    }
  },
};
export function getCalendarWindow(input: CalendarWindowInput): Promise<CalendarWindowResult> {
  window.calendarContract.reads.push(input);
  return new Promise((resolve) => reads.push({ input, resolve }));
}
// The board context rides beside every window read; the contracts count the window reads.
export async function getCalendarBoard(): Promise<CalendarBoardResult> {
  return { success: true, rows: [], days: [], dispatch: [], materialDemandJobIds: [] };
}
export async function getChangeRequestsForEntries(): Promise<{ success: true; requests: [] }> {
  return { success: true, requests: [] };
}
export function createSupabaseBrowserClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "contract-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    realtime: { setAuth() {} },
    channel() {
      const channel: Channel = { listeners: [] };
      channels.push(channel);
      const adapter = {
        on(kind: string, filter: { table: string }, callback: (payload: unknown) => void) {
          if (kind === 'system') channel.system = callback;
          else channel.listeners.push({ table: filter.table, callback });
          return adapter;
        },
        subscribe(callback: (status: string) => void) { channel.status = callback; return adapter; },
        dispose() { channel.status = undefined; channel.system = undefined; channel.listeners = []; },
      };
      return adapter;
    },
    removeChannel(channel: { dispose: () => void }) { channel.dispose(); },
  };
}
