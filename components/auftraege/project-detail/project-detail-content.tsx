'use client';

import type { OriginRequestLink } from '../shared/origin-request-line';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

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
import { formatGermanDateTime } from '@/lib/utils';

interface ProjectDetailContentProps {
  project: Project;
  client: Client | null;
  jobs: Job[];
  derivedStatus: DerivedProjectStatus;
  clients: Client[];
  members: OrgMemberOption[];
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
  'project' | 'jobs' | 'clients' | 'members' | 'isAdminOrManager' | 'instructionItems'
>;

// Live state and Realtime wiring of the page. It stays in this file:
// eslint.config.mjs allows the raw useRealtimeEvent import only here.
function useProjectDetailState({
  project,
  jobs,
  clients,
  members,
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

  const dialogState = useProjectDetailDialogState({
    clients,
    members,
    isAdminOrManager,
  });

  const liveClient = useMemo(
    () => clients.find((entry) => entry.id === liveProject.clientId) ?? null,
    [clients, liveProject.clientId],
  );

  const { timeView, projectTimeEntries, projectTimeSummary, isLoadingTime, timeLoadError } =
    useProjectDetailTime(liveProject.id, liveJobs);

  // Server props are the authority for project and job facts: Realtime
  // changes trigger a debounced route refresh, and the sync effects above
  // adopt the fresh props.
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
    const oldId = (event.old as { id?: string } | null)?.id;
    if (event.eventType === 'DELETE' && oldId === liveProject.id) {
      router.push('/auftraege');
    }
  });

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
            label: `${group.jobTitle} · ${formatGermanDateTime(entry.timestamp)}`,
          })),
      ),
    [projectTimeEntries],
  );

  const completedCount = liveJobs.filter((j) => j.status === 'fertig').length;
  const inProgressCount = liveJobs.filter((j) => j.status === 'in_bearbeitung').length;
  const parkedCount = liveJobs.filter((j) => j.status === 'geparkt').length;

  const liveDerivedStatus = useMemo<DerivedProjectStatus>(() => {
    const status = getEffectiveProjectStatus(liveProject, liveJobs);
    return {
      status,
      progress: calculateProjectProgress(liveJobs),
      trafficLight: calculateTrafficLight(liveProject, liveJobs),
    };
  }, [liveJobs, liveProject]);

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
    liveDerivedStatus,
  };
}

export function ProjectDetailContent({
  project,
  jobs,
  clients,
  members,
  isAdminOrManager,
  canApproveWorkArtifacts,
  currentUserId,
  instructionItems,
  initialArtifacts,
  projectDocuments,
  jobDocumentGroups,
  materialSummary,
  inventoryItems,
  inventoryLocations,
  lifecycleSnapshot,
  handoverWorkspace,
  originRequest,
}: ProjectDetailContentProps) {
  const {
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
    liveDerivedStatus,
  } = useProjectDetailState({
    project,
    jobs,
    clients,
    members,
    isAdminOrManager,
    instructionItems,
  });

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
        setShowCreateJob={dialogState.setShowCreateJob}
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
        {/* Columns follow the width of this content, not of the screen: the app sidebar takes
            256 px, so a screen breakpoint turned the columns on where they did not fit. */}
        <div className="@container/detail">
          <div className="grid grid-cols-1 gap-6 @4xl/detail:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            {/* Left Column: Metadata + Client */}
            <div className="min-w-0 space-y-6">
              <MetadataSection title="Details" fields={metadataFields} isEditable={isAdminOrManager} />

              <ProjectDetailClientCard
                liveClient={liveClient}
                onAssignClient={isAdminOrManager ? () => dialogState.setShowClientDialog(true) : undefined}
              />
            </div>

            {/* Right Column: Progress + Jobs + Placeholders */}
            <div className="min-w-0 space-y-6">
              <ProjectDetailProgressCard
                liveDerivedStatus={liveDerivedStatus}
                completedCount={completedCount}
                inProgressCount={inProgressCount}
                jobCount={liveJobs.length}
              />

              <ProjectDetailChildJobsCard
                jobs={liveJobs}
                project={liveProject}
                isAdminOrManager={isAdminOrManager}
                onAssignJobs={() => dialogState.setShowAssignJobsDialog(true)}
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

              {initialArtifacts ? (
                <WorkArtifactsSection
                  targetType="project"
                  targetId={liveProject.id}
                  initialArtifacts={initialArtifacts}
                  isManager={isAdminOrManager}
                  canApprove={canApproveWorkArtifacts}
                  currentUserId={currentUserId}
                  documents={projectDocuments ?? []}
                  evidenceRequirements={artifactEvidenceRequirements}
                  instructionOptions={artifactInstructionOptions}
                  timeEntryOptions={artifactTimeEntryOptions}
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

              <ProjectDetailTimeSummaryCard
                isLoadingTime={isLoadingTime}
                timeLoadError={timeLoadError}
                timeStale={timeView.isStale}
                onRetry={timeView.refresh}
                retryPending={timeView.isRefreshing}
                projectTimeSummary={projectTimeSummary}
              />
            </div>
          </div>
        </div>
      </PageBody>

      <ProjectDetailDialogs
        project={project}
        liveProject={liveProject}
        liveClient={liveClient}
        liveJobs={liveJobs}
        completedCount={completedCount}
        inProgressCount={inProgressCount}
        parkedCount={parkedCount}
        setLiveProject={setLiveProject}
        setLiveJobs={setLiveJobs}
        dialogState={dialogState}
      />
    </PageShell>
  );
}
