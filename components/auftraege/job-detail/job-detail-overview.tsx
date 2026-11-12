'use client';

import type { JobWithDetails, Project } from '@/lib/jobs/types';
import type { WorkRequestEntry } from '@/lib/requests/types';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { WorkLifecycleCard, WorkLifecycleLoadError } from '../lifecycle/work-lifecycle-card';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { WorkHandoverSummary } from '../handover/work-handover-section';
import { OriginRequestLine, type OriginRequestLink } from '../shared/origin-request-line';
import { WorkRequestEntriesSection } from '../shared/work-request-entries-section';

type JobDetailOverviewProps = {
  liveJob: JobWithDetails;
  parentProject: Pick<Project, 'id' | 'name' | 'projectNumber'> | undefined;
  displayTitle: string;
  isAdminOrManager: boolean;
  lifecycleSnapshot: WorkLifecycleSnapshot | null;
  // Null: the read failed. 'not_reviewer': the user does not hold the handover review.
  handoverWorkspace: WorkHandoverWorkspace | 'not_reviewer' | null;
  originRequest: OriginRequestLink | undefined;
  // Undefined: the server read failed, and the section reads them itself.
  requestEntries: WorkRequestEntry[] | undefined;
};

/** Origin request, work lifecycle, handover summary and attached requests: the block above the two columns. */
export function JobDetailOverview({
  liveJob,
  parentProject,
  displayTitle,
  isAdminOrManager,
  lifecycleSnapshot,
  handoverWorkspace,
  originRequest,
  requestEntries,
}: JobDetailOverviewProps) {
  return (
    <>
      {isAdminOrManager ? <OriginRequestLine originRequest={originRequest} /> : null}
      <div className="mb-6">
        {lifecycleSnapshot ? (
          <WorkLifecycleCard
            initialSnapshot={lifecycleSnapshot}
            targetLabel={displayTitle}
            isManager={isAdminOrManager}
          />
        ) : (
          <WorkLifecycleLoadError />
        )}
        {handoverWorkspace === null && (
          <RegionLoadError className="mt-4">Die Übergabe konnte nicht geladen werden.</RegionLoadError>
        )}
        {handoverWorkspace !== null && handoverWorkspace !== 'not_reviewer' && (
          <div className="mt-4">
            <WorkHandoverSummary
              workspace={handoverWorkspace}
              href={
                liveJob.jobNumber && parentProject?.projectNumber
                  ? `/auftraege/projekt/${encodeURIComponent(parentProject.projectNumber)}/${encodeURIComponent(liveJob.jobNumber)}/uebergabe`
                  : liveJob.jobNumber
                    ? `/auftraege/${encodeURIComponent(liveJob.jobNumber)}/uebergabe`
                    : `/auftraege/uebergaben/auftrag/${handoverWorkspace.targetId}`
              }
            />
          </div>
        )}
      </div>
      {isAdminOrManager ? (
        <WorkRequestEntriesSection
          kind="job"
          id={liveJob.id}
          initialEntries={requestEntries}
          className="mb-6"
        />
      ) : null}
    </>
  );
}
