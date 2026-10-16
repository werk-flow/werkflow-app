'use client';

import { useMemo } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { JobEntityOption } from '@/lib/jobs/option-types';

type DocumentLinkEmployees = {
  employees: JobEntityOption[] | null;
  isLoadingEmployees: boolean;
  employeesFailure: ReadFailure | null;
};

// Loads the complete staff list once each time the dialog shows a document.
export function useDocumentLinkEmployees(isDialogShowingDocument: boolean): DocumentLinkEmployees {
  const { activeOrgId } = useOrganization();
  const staff = useClientRead({
    read: (signal) =>
      readInBackground('document-link-employees', { organizationId: activeOrgId ?? '' }, signal),
    deps: [activeOrgId],
    enabled: isDialogShowingDocument,
    failureMessage: 'Die Mitarbeiter konnten nicht geladen werden.',
  });
  const loaded = staff.data?.employees;
  const employees = useMemo(
    () =>
      loaded?.map((employee) => ({
        value: employee.userId,
        label: employee.name || employee.email || 'Mitarbeiter',
      })) ?? null,
    [loaded],
  );
  return { employees, isLoadingEmployees: staff.loading, employeesFailure: staff.failure };
}
