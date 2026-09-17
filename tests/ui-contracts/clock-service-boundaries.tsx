import type { ComponentProps } from 'react';
import type { OrgContextValue } from '@/components/organization/organization-context';
import type { TimeTransitionInput } from '@/lib/time-tracking/segment-actions';
import type { TimeTransitionResult } from '@/lib/time-tracking/types';
import { CLOCK_ORGANIZATION_ID, RUNNING_CLOCK_STATE } from './clock-state-fixture';

declare global {
  interface Window {
    clockContract: {
      transitions: TimeTransitionInput[];
      directResult: TimeTransitionResult | null;
      resolveTransition: (() => void) | null;
    };
  }
}

export function useOrganization(): Pick<OrgContextValue, 'activeOrgId' | 'activeOrg'> {
  return {
    activeOrgId: CLOCK_ORGANIZATION_ID,
    activeOrg: {
      orgId: CLOCK_ORGANIZATION_ID,
      name: 'Zeitvertrag',
      uniqueCode: 'CLOCK',
      role: 'employee',
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

export async function transitionTimeActivity(input: TimeTransitionInput): Promise<TimeTransitionResult> {
  window.clockContract.transitions.push(input);
  await new Promise<void>((resolve) => { window.clockContract.resolveTransition = resolve; });
  window.clockContract.resolveTransition = null;
  return {
    success: true,
    outcome: 'active',
    sessionId: RUNNING_CLOCK_STATE.sessionId,
    segmentId: RUNNING_CLOCK_STATE.currentSegmentId,
    version: 8,
    recoveryReason: null,
    replayed: false,
    legacyBridged: false,
  };
}

// Job selection is outside this contract; clock reads and mutations stay distinct.
export function JobPickerModal(props: ComponentProps<typeof import('@/components/job-picker-modal').JobPickerModal>): null {
  if (props.open) throw new Error('The clock readiness contract must not open the job picker.');
  return null;
}
