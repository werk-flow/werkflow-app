'use client';

import { useEffect, useState } from 'react';

import { getDocumentLinkEmployees } from '@/lib/documents/actions';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { useServerAction } from '@/hooks/use-server-action';

type DocumentLinkEmployees = {
  employees: JobEntityOption[] | null;
  employeesFailed: boolean;
  isLoadingEmployees: boolean;
  needsEmployees: boolean;
  retryEmployees: () => void;
};

// Loads the complete staff list once while the dialog shows a document.
export function useDocumentLinkEmployees(isDialogShowingDocument: boolean): DocumentLinkEmployees {
  const [employees, setEmployees] = useState<JobEntityOption[] | null>(null);
  const [employeesFailed, setEmployeesFailed] = useState(false);
  const { run: loadEmployees, isPending: isLoadingEmployees } = useServerAction(getDocumentLinkEmployees);
  const needsEmployees = isDialogShowingDocument && employees === null && !employeesFailed;
  useEffect(() => {
    if (!needsEmployees) return;
    let cancelled = false;
    void loadEmployees()
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setEmployeesFailed(true);
          return;
        }
        setEmployees(
          result.employees.map((employee) => ({
            value: employee.userId,
            label: employee.name || employee.email || 'Mitarbeiter',
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setEmployeesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsEmployees, loadEmployees]);

  // Clearing the failure makes the list needed again, so the effect reloads it.
  const retryEmployees = (): void => setEmployeesFailed(false);

  return { employees, employeesFailed, isLoadingEmployees, needsEmployees, retryEmployees };
}
