'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { useState } from 'react';
import { Award } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { setJobCapabilityRequirements } from '@/lib/qualifications/requirement-actions';
import { readInBackground } from '@/lib/data/background-read-client';
import type { JobQualificationDetail } from '@/lib/qualifications/types';
import { ADD_BUSY_ID, JobQualificationAddForm } from './job-qualification-add-form';
import {
  JobQualificationCoverageList,
  type SaveJobQualificationRequirements,
} from './job-qualification-coverage-list';

const SAVE_FAILED_MESSAGE = 'Die Anforderungen konnten nicht gespeichert werden.';

/** The section's skeleton while the first read runs. */
function JobQualificationSectionLoading() {
  return (
    <Card className="gap-4 p-4" role="status" aria-busy="true">
      <span className="sr-only">Qualifikationsabdeckung wird geladen.</span>
      <div className="flex items-center gap-2">
        <Skeleton className="size-4" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </Card>
  );
}

function JobQualificationSectionHeading({ isAdding }: { isAdding: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Award className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Qualifikationsabdeckung</h2>
        <InlinePending active={isAdding} label="Anforderung wird gespeichert" />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Zeigt die von der Organisation hinterlegten Planungshinweise. Keine rechtliche Einsatzbewertung.
      </p>
    </div>
  );
}

// Every save replaces the whole requirement list, so saves stay mutually
// exclusive (`anyBusy` disables the controls); `busyId` only chooses where
// the spinner shows. Never rejects: every failure lands in `saveError`.
async function saveJobQualificationRequirements({
  jobId,
  busyId,
  requirements,
  runSave,
  setSaveError,
  refresh,
}: {
  jobId: string;
  busyId: string;
  requirements: Parameters<SaveJobQualificationRequirements>[1];
  runSave: ReturnType<typeof useBusyIds>['run'];
  setSaveError: (error: string | null) => void;
  refresh: () => Promise<void>;
}): Promise<boolean> {
  setSaveError(null);
  try {
    const result = await runSave(busyId, () => setJobCapabilityRequirements({ jobId, requirements }));
    if (!result.success) {
      setSaveError(SAVE_FAILED_MESSAGE);
      return false;
    }
    await refresh();
    return true;
  } catch {
    setSaveError(SAVE_FAILED_MESSAGE);
    return false;
  }
}

export function JobQualificationSection({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [selectedCapabilityId, setSelectedCapabilityId] = useState('');
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { run: runSave, isBusy, anyBusy } = useBusyIds();

  const view = useLiveView<JobQualificationDetail>({
    tables: [
      'job_capability_requirements',
      'job_assignments',
      'employee_capabilities',
      'organization_capabilities',
    ],
    read: async ({ signal }): Promise<LiveViewResult<JobQualificationDetail>> => {
      const result = await readInBackground('job-qualification-detail', { jobId }, signal);
      return result.success ? { ok: true, data: result.data } : { ok: false };
    },
    resetKey: jobId,
  });
  const { refresh } = view;
  const detail = view.data;

  if (detail === undefined) {
    if (view.isLoading) return <JobQualificationSectionLoading />;
    return (
      <SectionError onRetry={() => void refresh()}>
        Qualifikationsabdeckung konnte nicht geladen werden.
      </SectionError>
    );
  }

  // Every save replaces the whole requirement list, so saves stay mutually
  // exclusive (`anyBusy` disables the controls); `busyId` only chooses where
  // the spinner shows. Never rejects: every failure lands in `saveError`.
  const saveRequirements: SaveJobQualificationRequirements = (busyId, requirements) =>
    saveJobQualificationRequirements({ jobId, busyId, requirements, runSave, setSaveError, refresh });

  return (
    <Card className="gap-4 p-4">
      <JobQualificationSectionHeading isAdding={isBusy(ADD_BUSY_ID)} />

      <StaleRegion stale={view.isStale} onRetry={refresh} className="flex flex-col gap-4">
        {canEdit && (
          <JobQualificationAddForm
            detail={detail}
            selectedCapabilityId={selectedCapabilityId}
            setSelectedCapabilityId={setSelectedCapabilityId}
            requireConfirmation={requireConfirmation}
            setRequireConfirmation={setRequireConfirmation}
            anyBusy={anyBusy}
            saveRequirements={saveRequirements}
          />
        )}

        <ErrorText>{saveError}</ErrorText>

        <JobQualificationCoverageList
          detail={detail}
          canEdit={canEdit}
          isBusy={isBusy}
          anyBusy={anyBusy}
          saveRequirements={saveRequirements}
        />

        {detail.latestAssessment?.overrideReason && (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
            <span className="font-medium">Letzte begründete Ausnahme:</span>{' '}
            {detail.latestAssessment.overrideReason}
          </div>
        )}
      </StaleRegion>
    </Card>
  );
}
