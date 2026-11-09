import { RegionLoadError } from '@/components/shared/region-load-error';
import type { Project } from '@/lib/jobs/types';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import { WorkHandoverSummary } from '../handover/work-handover-section';
import { OriginRequestLine, type OriginRequestLink } from '../shared/origin-request-line';
import { WorkRequestEntriesSection } from '../shared/work-request-entries-section';
import { WorkLifecycleCard, WorkLifecycleLoadError } from '../lifecycle/work-lifecycle-card';

type ProjectDetailOverviewProps = {
  liveProject: Project;
  lifecycleSnapshot: WorkLifecycleSnapshot | null;
  // Null: the read failed. 'not_reviewer': the user does not hold the handover review.
  handoverWorkspace: WorkHandoverWorkspace | 'not_reviewer' | null;
  isAdminOrManager: boolean;
  originRequest: OriginRequestLink | undefined;
};

/** Above the columns: the originating Anfrage, the lifecycle, the handover and the attached requests. */
export function ProjectDetailOverview({
  liveProject,
  lifecycleSnapshot,
  handoverWorkspace,
  isAdminOrManager,
  originRequest,
}: ProjectDetailOverviewProps) {
  return (
    <>
      {isAdminOrManager ? <OriginRequestLine originRequest={originRequest} /> : null}
      <div className="mb-6">
        {lifecycleSnapshot ? (
          <WorkLifecycleCard
            initialSnapshot={lifecycleSnapshot}
            targetLabel={liveProject.name}
            isManager={isAdminOrManager}
            // An assigned employee reads the project's work state; every project transition is a manager's.
            readOnly={!isAdminOrManager}
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
                liveProject.projectNumber
                  ? `/auftraege/projekt/${encodeURIComponent(liveProject.projectNumber)}/uebergabe`
                  : `/auftraege/uebergaben/projekt/${handoverWorkspace.targetId}`
              }
            />
          </div>
        )}
      </div>
      {isAdminOrManager ? <WorkRequestEntriesSection kind="project" id={liveProject.id} className="mb-6" /> : null}
    </>
  );
}
