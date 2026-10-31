'use client';

import type { OriginRequestLink } from '../shared/origin-request-line';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { DetailColumns } from '@/components/shared/detail-columns';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { MetadataSection } from '@/components/shared/metadata-section';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { WorkArtifactsSection } from '../artifacts/work-artifacts-section';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';

import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  calculateProjectProgress,
  calculateTrafficLight,
  getEffectiveProjectStatus,
  type Project,
  type Client,
  type Job,
  type JobInstructionItemWithDetails,
  type DerivedProjectStatus,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import type { OrganizationDocument, ProjectJobDocumentGroup } from '@/lib/documents/types';
import type { InventoryLocation, InventoryPickerOption, ProjectMaterialSummary } from '@/lib/inventory/types';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { ProjectDetailChildJobsCard } from './project-detail-child-jobs-card';
import { ProjectDetailClientCard } from './project-detail-client-card';
import { ProjectDetailDialogs } from './project-detail-dialogs';
import { ProjectDetailHeader } from './project-detail-header';
import { ProjectDetailManagerSections } from './project-detail-manager-sections';
import { buildProjectDetailMetadataFields } from './project-detail-metadata-fields';
import { ProjectDetailOverview } from './project-detail-overview';
import { ProjectDetailProgressCard } from './project-detail-progress-card';
import { ProjectDetailTimeSummaryCard } from './project-detail-time-summary-card';
import { useProjectDetailDialogState } from './use-project-detail-dialog-state';
import { useProjectDetailTime } from './use-project-detail-time';
import { formatBerlinDateTime } from '@/lib/utils';

interface ProjectDetailContentProps {
  project: Project;
  client: Client | null;
  jobs: Job[];
  derivedStatus: DerivedProjectStatus;
  /** Null: the member read failed; creating a job needs it, so the jobs card shows the failure. */
  members: OrgMemberOption[] | null;
  isAdminOrManager: boolean;
  canApproveWorkArtifacts: boolean;
  currentUserId: string;
  // Null: the server read failed, and the region shows the failure.
  instructionItems: JobInstructionItemWithDetails[] | null;
  initialArtifacts: WorkArtifactSummary[] | null;
  projectDocuments: OrganizationDocument[] | null;
  jobDocumentGroups: ProjectJobDocumentGroup[];
  materialSummary: ProjectMaterialSummary | null;
  inventoryItems: InventoryPickerOption[] | null;
  inventoryLocations: InventoryLocation[] | null;
  lifecycleSnapshot: WorkLifecycleSnapshot | null;
  handoverWorkspace: WorkHandoverWorkspace | 'not_reviewer' | null;
  // Set when this project was created by converting an Anfrage (P1-02).
  originRequest?: OriginRequestLink;
}

type ProjectDetailStateOptions = Pick<
  ProjectDetailContentProps,
  'project' | 'client' | 'jobs' | 'derivedStatus' | 'isAdminOrManager' | 'instructionItems'
>;

type ProjectDetailRealtimeOptions = {
  router: ReturnType<typeof useRouter>;
  liveProjectId: string;
  isAdminOrManager: boolean;
};

function useProjectDetailRealtime({ router, liveProjectId, isAdminOrManager }: ProjectDetailRealtimeOptions) {
  // Server props are the authority for project and job facts: Realtime
  // changes trigger a debounced route refresh, and useProjectDetailState
  // adopts the fresh props during render.
  useRealtimeRouterRefresh({
    tables: [
      'projects',
      'jobs',
      'job_assignments',
      'job_instruction_items',
      'job_instruction_item_evidence_fulfillments',
      'work_handover_packages',
    ],
  });

  useRealtimeRouterRefresh({
    tables: [
      'job_material_lines',
      'inventory_stock_levels',
      'inventory_movements',
      'inventory_items',
      'inventory_locations',
    ],
    enabled: isAdminOrManager,
  });

  // Deliberate narrow event consumer: leaving the page of a project another
  // session just deleted needs the event itself (DELETE payloads carry the
  // id), not a refetch.
  useRealtimeEvent('projects', (event) => {
    const oldId = event.old?.id;
    if (event.eventType === 'DELETE' && oldId === liveProjectId) {
      router.push('/auftraege');
    }
  });
}

function useProjectArtifactOptions(
  instructionItems: JobInstructionItemWithDetails[] | null,
  projectTimeEntries: ReturnType<typeof useProjectDetailTime>['projectTimeEntries'],
) {
  const artifactEvidenceRequirements = useMemo(
    () => (instructionItems ?? []).flatMap((item) => item.evidenceRequirements),
    [instructionItems],
  );
  const artifactInstructionOptions = useMemo(
    () => (instructionItems ?? []).map((item) => ({ id: item.id, label: item.content })),
    [instructionItems],
  );
  const artifactTimeEntryOptions = useMemo(
    () =>
      projectTimeEntries.flatMap((group) =>
        group.entries
          .filter((entry) => entry.entryType === 'clock_in')
          .map((entry) => ({
            id: entry.canonicalSegmentId ?? entry.id,
            sourceType: entry.canonicalSegmentId ? ('time_segment' as const) : ('time_entry' as const),
            label: `${group.jobTitle} · ${formatBerlinDateTime(entry.timestamp)}`,
          })),
      ),
    [projectTimeEntries],
  );
  return { artifactEvidenceRequirements, artifactInstructionOptions, artifactTimeEntryOptions };
}

// Live state and Realtime wiring of the page. It stays in this file:
// eslint.config.mjs allows the raw useRealtimeEvent import only here.
function useProjectDetailState({
  project,
  jobs,
  client,
  derivedStatus,
  isAdminOrManager,
  instructionItems,
}: ProjectDetailStateOptions) {
  const router = useRouter();
  const [liveProject, setLiveProject] = useState(project);
  const [liveJobs, setLiveJobs] = useState(jobs);
  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedProps, setAdoptedProps] = useState({ project, jobs });
  if (project !== adoptedProps.project || jobs !== adoptedProps.jobs) {
    setAdoptedProps({ project, jobs });
    if (project !== adoptedProps.project) setLiveProject(project);
    if (jobs !== adoptedProps.jobs) setLiveJobs(jobs);
  }

  const dialogState = useProjectDetailDialogState();

  // The server's customer row; a changed link shows once the save renders the route.
  const liveClient = client && client.id === liveProject.clientId ? client : null;

  const { timeView, projectTimeEntries, projectTimeSummary, isLoadingTime, timeLoadError } =
    useProjectDetailTime(liveProject.id, liveJobs);

  useProjectDetailRealtime({ router, liveProjectId: liveProject.id, isAdminOrManager });

  const { artifactEvidenceRequirements, artifactInstructionOptions, artifactTimeEntryOptions } =
    useProjectArtifactOptions(instructionItems, projectTimeEntries);

  const completedCount = liveJobs.filter((j) => j.status === 'fertig').length;
  const inProgressCount = liveJobs.filter((j) => j.status === 'in_bearbeitung').length;
  const parkedCount = liveJobs.filter((j) => j.status === 'geparkt').length;

  const serverStatus = isAdminOrManager ? null : derivedStatus;
  const liveDerivedStatus = useLiveDerivedStatus(liveProject, liveJobs, serverStatus);

  return {
    liveProject,
    setLiveProject,
    liveJobs,
    setLiveJobs,
    dialogState,
    liveClient,
    timeView,
    projectTimeSummary,
    isLoadingTime,
    timeLoadError,
    artifactEvidenceRequirements,
    artifactInstructionOptions,
    artifactTimeEntryOptions,
    completedCount,
    inProgressCount,
    parkedCount,
    progressJobCounts: isAdminOrManager
      ? { completed: completedCount, inProgress: inProgressCount, total: liveJobs.length }
      : null,
    liveDerivedStatus,
  };
}

/**
 * A manager's status follows the live project and jobs. An employee's job list
 * holds only their own jobs, so the server's status, which covers every job, stays.
 */
function useLiveDerivedStatus(
  liveProject: Project,
  liveJobs: Job[],
  serverStatus: DerivedProjectStatus | null,
): DerivedProjectStatus {
  return useMemo(
    () =>
      serverStatus ?? {
        status: getEffectiveProjectStatus(liveProject, liveJobs),
        progress: calculateProjectProgress(liveJobs),
        trafficLight: calculateTrafficLight(liveProject, liveJobs),
      },
    [liveJobs, liveProject, serverStatus],
  );
}

type ProjectDetailState = ReturnType<typeof useProjectDetailState>;

type ProjectDetailSectionProps = {
  content: ProjectDetailContentProps;
  state: ProjectDetailState;
};

export function ProjectDetailContent(content: ProjectDetailContentProps) {
  const {
    project,
    jobs,
    client,
    derivedStatus,
    members,
    isAdminOrManager,
    instructionItems,
    lifecycleSnapshot,
    handoverWorkspace,
    originRequest,
  } = content;
  const state = useProjectDetailState({
    project,
    jobs,
    client,
    derivedStatus,
    isAdminOrManager,
    instructionItems,
  });
  const { liveProject, setLiveProject, liveJobs, setLiveJobs, dialogState, liveClient, liveDerivedStatus } =
    state;

  const metadataFields = buildProjectDetailMetadataFields({
    project,
    liveProject,
    liveDerivedStatus,
    isAdminOrManager,
    setLiveProject,
  });

  return (
    <PageShell>
      <ProjectDetailHeader
        liveProject={liveProject}
        liveDerivedStatus={liveDerivedStatus}
        isAdminOrManager={isAdminOrManager}
        setShowCreateJob={members ? dialogState.setShowCreateJob : null}
        setShowEditDialog={dialogState.setShowEditDialog}
        setShowDeleteDialog={dialogState.setShowDeleteDialog}
      />

      <PageBody>
        <ProjectDetailOverview
          liveProject={liveProject}
          lifecycleSnapshot={lifecycleSnapshot}
          handoverWorkspace={handoverWorkspace}
          isAdminOrManager={isAdminOrManager}
          originRequest={originRequest}
        />
        <DetailColumns layout="facts-and-work">
          {/* Left Column: Metadata + Client */}
          <div className="min-w-0 space-y-6">
            <MetadataSection title="Details" fields={metadataFields} isEditable={isAdminOrManager} />

            <ProjectDetailClientCard
              liveClient={liveClient}
              onAssignClient={isAdminOrManager ? () => dialogState.setShowClientDialog(true) : undefined}
            />
          </div>

          {/* Right Column: Progress + Jobs + Placeholders */}
          <ProjectDetailWorkColumn content={content} state={state} />
        </DetailColumns>
      </PageBody>

      <ProjectDetailDialogs
        project={project}
        liveProject={liveProject}
        liveClient={liveClient}
        liveJobs={liveJobs}
        completedCount={state.completedCount}
        inProgressCount={state.inProgressCount}
        parkedCount={state.parkedCount}
        setLiveProject={setLiveProject}
        setLiveJobs={setLiveJobs}
        dialogState={dialogState}
        members={members}
      />
    </PageShell>
  );
}

function ProjectDetailWorkColumn({ content, state }: ProjectDetailSectionProps) {
  const { isAdminOrManager, members, instructionItems, materialSummary, inventoryItems, inventoryLocations } =
    content;
  const { liveProject, liveJobs, liveDerivedStatus, dialogState, timeView } = state;

  return (
    <div className="min-w-0 space-y-6">
      <ProjectDetailProgressCard liveDerivedStatus={liveDerivedStatus} jobCounts={state.progressJobCounts} />

      <ProjectDetailChildJobsCard
        jobs={liveJobs}
        project={liveProject}
        isAdminOrManager={isAdminOrManager}
        onAssignJobs={() => dialogState.setShowAssignJobsDialog(true)}
        membersFailed={members === null}
      />

      {isAdminOrManager ? (
        <ProjectDetailManagerSections
          liveProject={liveProject}
          instructionItems={instructionItems}
          materialSummary={materialSummary}
          inventoryItems={inventoryItems}
          inventoryLocations={inventoryLocations}
        />
      ) : null}

      <ProjectDetailEvidenceSections content={content} state={state} />

      <ProjectDetailTimeSummaryCard
        isLoadingTime={state.isLoadingTime}
        timeLoadError={state.timeLoadError}
        timeStale={timeView.isStale}
        onRetry={timeView.refresh}
        retryPending={timeView.isRefreshing}
        projectTimeSummary={state.projectTimeSummary}
      />
    </div>
  );
}

function ProjectDetailEvidenceSections({ content, state }: ProjectDetailSectionProps) {
  const { isAdminOrManager, initialArtifacts, projectDocuments, jobDocumentGroups } = content;
  const { liveProject } = state;

  return (
    <>
      {initialArtifacts ? (
        <WorkArtifactsSection
          targetType="project"
          targetId={liveProject.id}
          initialArtifacts={initialArtifacts}
          isManager={isAdminOrManager}
          canApprove={content.canApproveWorkArtifacts}
          currentUserId={content.currentUserId}
          documents={projectDocuments ?? []}
          evidenceRequirements={state.artifactEvidenceRequirements}
          instructionOptions={state.artifactInstructionOptions}
          timeEntryOptions={state.artifactTimeEntryOptions}
        />
      ) : (
        <RegionLoadError>Arbeitsnachweise konnten nicht geladen werden.</RegionLoadError>
      )}

      {projectDocuments ? (
        <ContextualDocumentsSection
          title="Dokumente"
          description="Projektdateien und verknüpfte Auftragsdokumente an einem Ort."
          documents={projectDocuments}
          jobDocumentGroups={jobDocumentGroups}
          documentTarget={{ kind: 'project', projectId: liveProject.id }}
          contextLabel={liveProject.name}
          canUpload={isAdminOrManager}
          canManage={isAdminOrManager}
        />
      ) : (
        <RegionLoadError>Dokumente konnten nicht geladen werden.</RegionLoadError>
      )}
    </>
  );
}
