'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useLiveView } from '@/hooks/use-live-view';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useServerAction } from '@/hooks/use-server-action';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  exportPersonnelLifecycleManifest,
  type PersonnelLifecycleView,
} from '@/lib/personnel/lifecycle-actions';

import { errorMessage } from './personnel-lifecycle-errors';
import { logError } from '@/lib/logging';

export type PersonnelLifecycleController = ReturnType<typeof usePersonnelLifecycleView>;

/**
 * Owns the live lifecycle view, the shared mutation transition and the error
 * state every lifecycle dialog shares.
 */
export function usePersonnelLifecycleView(initialData: PersonnelLifecycleView) {
  const { showBanner } = useBanner();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const view = useLiveView<PersonnelLifecycleView>({
    initialData,
    tables: [
      'personnel_access_lifecycles',
      'personnel_employment_lifecycles',
      'personnel_documents',
      'personnel_document_releases',
      'personnel_onboarding_templates',
      'personnel_onboarding_plans',
      'personnel_onboarding_requirements',
      'employee_records',
      'organization_members',
      'profiles',
      'documents',
      'jobs',
      'job_assignments',
      'organization_responsibility_configurations',
      'organization_responsibility_assignments',
      'organization_responsibility_delegations',
    ],
    // Reads over GET, so the lifecycle mutations never queue behind this read.
    read: async ({ signal }) => {
      const result = await readInBackground(
        'personnel-lifecycle',
        { employeeRecordId: initialData.employeeRecordId },
        signal,
      );
      return result.success ? { ok: true, data: result.data } : { ok: false, error: result.error };
    },
  });
  const data = view.data ?? initialData;

  const { run, isPending } = useServerAction(async (task: () => Promise<void>) => task());
  const mutationDisabled = isPending || view.isStale;
  const rowBusy = useBusyIds();

  function reconcileMutation(): void {
    // Every lifecycle mutation revalidates, so its response already renders the route.
    // The owned reader settles independently of route commits and mutation pending.
    void view.refresh();
  }
  /** The stale_version text promises a refresh; the owned reader delivers it (Step 3 release run 6). */
  function failureMessage(code: string): string {
    if (code === 'stale_version') void view.refresh();
    return errorMessage(code);
  }

  async function downloadManifest(): Promise<void> {
    try {
      await run(async () => {
        const result = await exportPersonnelLifecycleManifest(data.employeeRecordId);
        if (!result.success) {
          showBanner({ variant: 'error', message: failureMessage(result.error) });
          return;
        }
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(result.data, null, 2)], {
            type: 'application/json',
          }),
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `personalprozess-${data.employeeRecordId}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
      });
    } catch (downloadError) {
      logError('Unexpected error exporting the personnel lifecycle manifest:', downloadError);
      showBanner({
        variant: 'error',
        message: 'Der Arbeitsstand konnte nicht exportiert werden.',
      });
    }
  }

  return {
    data,
    view,
    run,
    isPending,
    mutationDisabled,
    rowBusy,
    showBanner,
    error,
    setError,
    fieldErrors,
    setFieldErrors,
    reconcileMutation,
    failureMessage,
    downloadManifest,
  };
}
