'use client';

import { useEffect, useMemo, useState } from 'react';

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
  loadError: string | null;
  retryLoadMembers: () => void;
} {
  const [members, setMembers] = useState<OrgMember[]>(prefetchedMembers ?? []);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  // A failed option load leaves a select empty; the reason must be visible.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by the retry so the load effect runs again.
  const [reloadCount, setReloadCount] = useState(0);

  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedMembers, setAdoptedMembers] = useState(prefetchedMembers);
  if (prefetchedMembers !== adoptedMembers) {
    setAdoptedMembers(prefetchedMembers);
    if (prefetchedMembers) {
      setMembers(prefetchedMembers);
      setIsLoadingMembers(false);
      setLoadError(null);
    }
  }
  // Loaded members belong to one organization; a switch never shows the previous one's.
  const [membersOrgId, setMembersOrgId] = useState(activeOrgId);
  if (activeOrgId !== membersOrgId) {
    setMembersOrgId(activeOrgId);
    if (!prefetchedMembers) setMembers([]);
  }

  useEffect(() => {
    if (!isActive || !isAdminOrManager || !activeOrgId || prefetchedMembers) return;
    // An answer for an organization the user has switched away from is dropped.
    const controller = new AbortController();
    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      setLoadError(null);
      try {
        const result = await readInBackground(
          'organization-member-options',
          { organizationId: activeOrgId },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.success) {
          setMembers(
            (result.members || []).map((member) => ({
              userId: member.user_id,
              firstName: member.first_name ?? '',
              lastName: member.last_name ?? '',
              email: member.email,
              role: member.role,
            })),
          );
        } else {
          setLoadError('Die Mitarbeiterliste konnte nicht geladen werden.');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingMembers(false);
      }
    };
    void fetchMembers();
    return () => controller.abort();
  }, [isActive, isAdminOrManager, activeOrgId, prefetchedMembers, reloadCount]);

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        value: m.userId,
        label: m.firstName || m.lastName ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : m.email,
        description: m.email,
      })),
    [members],
  );

  return {
    memberOptions,
    isLoadingMembers,
    loadError,
    retryLoadMembers: () => setReloadCount((count) => count + 1),
  };
}
