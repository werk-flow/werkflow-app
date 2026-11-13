import type { ComponentProps } from 'react';
import type { OrgContextValue } from '@/components/organization/organization-context';
import type { TimeTransitionInput } from '@/lib/time-tracking/segment-actions';
import type { TimeTransitionResult } from '@/lib/time-tracking/types';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID, RUNNING_CLOCK_STATE } from './clock-state-fixture';

declare global {
  interface Window {
    clockContract: {
      transitions: TimeTransitionInput[];
      directResult: TimeTransitionResult | null;
      resolveTransition: (() => void) | null;
      /** The online clock call fails on its way, as a lost connection does. */
      failTransition?: boolean;
      /** The next transition fails as the server would refuse it. */
      refuse?: boolean;
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

/** The signed-in person, as far as the clock's provider reads the profile. */
export function useUserProfile(): { profile: { id: string } } {
  return { profile: { id: CLOCK_USER_ID } };
}

export async function transitionTimeActivity(input: TimeTransitionInput): Promise<TimeTransitionResult> {
  window.clockContract.transitions.push(input);
  await new Promise<void>((resolve) => {
    window.clockContract.resolveTransition = resolve;
  });
  window.clockContract.resolveTransition = null;
  // Fails when the contract releases it, as a connection that drops after a while.
  if (window.clockContract.failTransition) throw new TypeError('Failed to fetch');
  if (window.clockContract.refuse) return { success: false, error: 'time_transition_failed' };
  return {
    success: true,
    outcome: input.action === 'end' ? 'ended' : 'active',
    sessionId: RUNNING_CLOCK_STATE.sessionId,
    segmentId: RUNNING_CLOCK_STATE.currentSegmentId,
    version: 8,
    recoveryReason: null,
    replayed: false,
    legacyBridged: false,
  };
}

// Job selection is outside this contract; clock reads and mutations stay distinct.
export function JobPickerModal(
  props: ComponentProps<typeof import('@/components/job-picker-modal').JobPickerModal>,
): null {
  if (props.open) throw new Error('The clock readiness contract must not open the job picker.');
  return null;
}
