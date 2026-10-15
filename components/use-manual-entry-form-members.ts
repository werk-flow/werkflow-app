'use client';

import { useMemo, useState } from 'react';

import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { CalendarEntryDialogMember } from '@/lib/jobs/types';

type OrgMember = CalendarEntryDialogMember;

/** The selectable employees of the manual entry form: prefetched by the caller or loaded here. */
export function useManualEntryMembers({
  isActive,
  isAdminOrManager,
  activeOrgId,
  prefetchedMembers,
}: {
  isActive: boolean;
  isAdminOrManager: boolean;
  activeOrgId: string | null;
  prefetchedMembers: OrgMember[] | undefined;
}): {
  memberOptions: Array<{ value: string; label: string; description: string }>;
  isLoadingMembers: boolean;
  /** A failed option load leaves the select empty; the reason and its retry must be visible. */
  membersFailure: ReadFailure | null;
} {
  // The list loads when the form is first shown and stays while its tab is hidden.
  const [wasActive, setWasActive] = useState(isActive);
  if (isActive && !wasActive) setWasActive(true);
  // Loaded members belong to one organization: a switch reads fresh and never shows the previous one's.
  const membersRead = useClientRead({
    read: (signal) =>
      readInBackground('organization-member-options', { organizationId: activeOrgId ?? '' }, signal),
    deps: [activeOrgId],
    enabled: wasActive && isAdminOrManager && Boolean(activeOrgId) && !prefetchedMembers,
    failureMessage: 'Die Mitarbeiterliste konnte nicht geladen werden.',
  });
  const loadedMembers = membersRead.data?.members;

  const memberOptions = useMemo(() => {
    const members: OrgMember[] =
      prefetchedMembers ??
      (loadedMembers ?? []).map((member) => ({
        userId: member.user_id,
        firstName: member.first_name ?? '',
        lastName: member.last_name ?? '',
        email: member.email,
        role: member.role,
      }));
    return members.map((m) => ({
      value: m.userId,
      label: m.firstName || m.lastName ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : m.email,
      description: m.email,
    }));
  }, [prefetchedMembers, loadedMembers]);

  return {
    memberOptions,
    isLoadingMembers: membersRead.loading,
    membersFailure: membersRead.failure,
  };
}
