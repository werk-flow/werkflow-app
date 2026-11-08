'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { SubstituteAbsenceSpan } from '@/lib/responsibilities/substitute-absence';

/**
 * The organization's absences from today on, read while the owner's delegation
 * dialog is open, so the settings page reads none. Null until they load or when
 * the read fails: the picker then marks nobody, and the save still refuses a
 * substitute absent on every day of the window.
 */
export function useSubstituteAbsences(open: boolean): SubstituteAbsenceSpan[] | null {
  const { activeOrgId } = useOrganization();
  const read = useClientRead({
    read: (signal) =>
      readInBackground('responsibility-substitute-absences', { organizationId: activeOrgId ?? '' }, signal),
    deps: [activeOrgId],
    enabled: open,
    failureMessage: 'Abwesenheiten konnten nicht geladen werden.',
  });
  return read.data?.absences ?? null;
}
