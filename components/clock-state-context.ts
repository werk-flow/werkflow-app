'use client';

import { createContext, useContext } from 'react';

import type { ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import type { ClockMarker } from '@/lib/field-sync/device/shown-clock-rule';
import type { LiveClockState, TimeActivitySelection, TimeTransitionResult } from '@/lib/time-tracking/types';

// The clock's context and its reader, apart from ClockStateProvider (clock-state-provider.tsx),
// which fills it. A reader imports only this module: the provider's display logic and outbox
// wiring stay with the shell, and a page that reads the clock does not regroup the shell's
// start-up chunks around them (werk-flow/werkflow-planning#22).

export type ClockStateContextValue = {
  /** The clock as shown (shown-clock.ts): the server's state, with the phone's unsent actions applied while they wait. */
  state: LiveClockState | null;
  /** The clock events the phone's outbox holds for the person and has not sent, as shown, or null. */
  unsent: ClockDeviceView | null;
  /** The calm marker beside the clock while what it shows is not the server's answer. */
  marker: ClockMarker;
  /** The clock as the server last confirmed it, without unsent events: what a settled chain goes on from. */
  confirmed: LiveClockState | null;
  /** The device storage failed: the phone cannot keep clock actions without signal now. */
  deviceFailed: boolean;
  isLoading: boolean;
  isReady: boolean;
  isPending: boolean;
  statusError: string | null;
  refresh: () => Promise<void>;
  transitionActivity: (selection: TimeActivitySelection) => Promise<TimeTransitionResult>;
  recoverAndContinue: (selection: TimeActivitySelection) => Promise<TimeTransitionResult>;
  clockIn: (jobId: string | null) => Promise<TimeTransitionResult>;
  clockOut: (acknowledgeRecovery?: boolean) => Promise<TimeTransitionResult>;
  switchJob: (jobId: string | null) => Promise<TimeTransitionResult>;
};

export const ClockStateContext = createContext<ClockStateContextValue | null>(null);

export function useClockState(): ClockStateContextValue {
  const context = useContext(ClockStateContext);
  if (!context) throw new Error('useClockState must be used within a ClockStateProvider');
  return context;
}
