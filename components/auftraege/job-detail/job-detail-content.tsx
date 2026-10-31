'use client';

import type { OriginRequestLink } from '../shared/origin-request-line';
import { useState, useCallback, useMemo, useRef } from 'react';
import { useActiveJobs } from '@/hooks/use-active-jobs';

import { DetailColumns } from '@/components/shared/detail-columns';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UsableContent } from '@/components/shared/usable-content';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';

import { readInBackground } from '@/lib/data/background-read-client';
import type { JobTimeParticipant, TimeEntry } from '@/lib/time-tracking/types';
import { useLiveView } from '@/hooks/use-live-view';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  getJobDisplayTitle,
  type JobWithDetails,
  type JobInstructionItemWithDetails,
  type Project,
} from '@/lib/jobs/types';

import type { OrgMemberOption } from '../shared/employee-multi-select';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { InventoryLocation, InventoryPickerOption, JobMaterialLine } from '@/lib/inventory/types';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { JobDetailMainColumn, JobDetailSideColumn } from './job-detail-columns';
import { JobDetailContentDialogs, useJobDetailDialogVisibility } from './job-detail-content-dialogs';
import { JobDetailHeader } from './job-detail-header';
import { JobDetailOverview } from './job-detail-overview';
import { useJobDetailAssignments } from './use-job-detail-assignments';
import { useJobDetailMetadataFields } from './use-job-detail-metadata-fields';
import { useJobDetailTimeSummary } from './use-job-detail-time-summary';

/** The shown job: the server prop, patched optimistically by saves until the next server read. */
function useJobDetailLiveJob(job: JobWithDetails) {
  const [liveJob, setLiveJob] = useState(job);
  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedJob, setAdoptedJob] = useState(job);
  if (job !== adoptedJob) {
    setAdoptedJob(job);
    setLiveJob(job);
  }

  const applyLiveJobPatch = useCallback((updatedJob: Partial<JobWithDetails>) => {
    setLiveJob((current) => ({
      ...current,
      ...updatedJob,
    }));
  }, []);

  return { liveJob, setLiveJob, applyLiveJobPatch };
}

// The background read stays in this file (lib/data/background-read-http.test.ts).
function useJobDetailTimeEntries(jobId: string) {
  const timeView = useLiveView<{
    entries: TimeEntry[];
    participants: JobTimeParticipant[];
  }>({
    tables: ['time_entries', 'time_sessions', 'time_segments'],
    read: async ({ signal }) => {
      const result = await readInBackground('time-entries-for-job', { jobId }, signal);
      if (!result.success) return { ok: false };
      return {
        ok: true,
        data: { entries: result.entries, participants: result.participants ?? [] },
      };
    },
    resetKey: jobId,
  });
  const timeEntries = useMemo(() => timeView.data?.entries ?? [], [timeView.data]);
  const timeParticipants = useMemo(() => timeView.data?.participants ?? [], [timeView.data]);

  return {
    timeEntries,
    timeParticipants,
    isLoadingTime: timeView.isLoading,
    isTimeStale: timeView.isStale,
    refreshTime: timeView.refresh,
  };
}

/** Realtime route refresh for the page, with the two refs that hold it back. */
function useJobDetailRefreshGate() {
  const isDeletingRef = useRef(false);
  // Suppresses route refreshes while a delete or a URL-changing project move
  // is mid-flight — a refresh landing then would remount a page that is
  // about to navigate away. Dialog suspension itself comes from the shared
  // open-dialog context.
  const suppressRefreshRef = useRef(false);

  useRealtimeRouterRefresh({
    tables: [
      'jobs',
      'projects',
      'job_assignments',
      'job_instruction_items',
      // The office sees a worker fulfil evidence without a reload.
      'job_instruction_item_evidence_fulfillments',
      'work_handover_packages',
      'job_material_lines',
      'inventory_stock_levels',
      'inventory_movements',
      'inventory_items',
      'inventory_locations',
    ],
    eventFilter: () => !isDeletingRef.current && !suppressRefreshRef.current,
  });

  return { isDeletingRef, suppressRefreshRef };
}

interface JobDetailContentProps {
  job: JobWithDetails;
  parentProject?: Pick<Project, 'id' | 'name' | 'projectNumber'>;
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  canApproveWorkArtifacts: boolean;
  // Null: the server read failed, and the region shows the failure.
  instructionItems: JobInstructionItemWithDetails[] | null;
  initialArtifacts: WorkArtifactSummary[] | null;
  documents: OrganizationDocument[] | null;
  materialLines: JobMaterialLine[] | null;
  inventoryItems: InventoryPickerOption[] | null;
  inventoryLocations: InventoryLocation[] | null;
  currentUserId: string;
  lifecycleSnapshot: WorkLifecycleSnapshot | null;
  handoverWorkspace: WorkHandoverWorkspace | 'not_reviewer' | null;
  // Set when this job was created by converting an Anfrage (P1-02).
  originRequest?: OriginRequestLink;
}

/** Every hook of the job page, in render order: the live job, dialogs, assignments, fields, time and refresh. */
function useJobDetailContentView({
  job,
  parentProject,
  members,
  isAdminOrManager,
}: Pick<JobDetailContentProps, 'job' | 'parentProject' | 'members' | 'isAdminOrManager'>) {
  const { liveJob, setLiveJob, applyLiveJobPatch } = useJobDetailLiveJob(job);
  const { activeJobIds } = useActiveJobs();
  const displayTitle = getJobDisplayTitle(liveJob);
  const isJobActive = activeJobIds.has(liveJob.id);
  const dialogs = useJobDetailDialogVisibility();
  const assignment = useJobDetailAssignments({
    liveJob,
    setLiveJob,
    dialogMembers: members,
    setShowAssignDialog: dialogs.setShowAssignDialog,
  });
  const { metadataFields, inlineEditWarningDialog } = useJobDetailMetadataFields({
    job,
    liveJob,
    displayTitle,
    isAdminOrManager,
    applyLiveJobPatch,
  });
  const { timeEntries, timeParticipants, isLoadingTime, isTimeStale, refreshTime } = useJobDetailTimeEntries(
    liveJob.id,
  );
  const { isDeletingRef, suppressRefreshRef } = useJobDetailRefreshGate();
  const timeSummary = useJobDetailTimeSummary({
    jobId: liveJob.id,
    assignments: liveJob.assignments,
    members,
    timeEntries,
    timeParticipants,
  });
  const projectInfo = parentProject ?? liveJob.project;

  return {
    liveJob,
    applyLiveJobPatch,
    displayTitle,
    isJobActive,
    dialogs,
    assignment,
    metadataFields,
    inlineEditWarningDialog,
    timeEntries,
    isLoadingTime,
    isTimeStale,
    refreshTime,
    isDeletingRef,
    suppressRefreshRef,
    timeSummary,
    projectInfo,
  };
}

type JobDetailContentView = ReturnType<typeof useJobDetailContentView>;

/** The two detail columns: metadata, customer and team left; project, material and time right. */
function JobDetailContentColumns({
  content,
  view,
}: {
  content: JobDetailContentProps;
  view: JobDetailContentView;
}) {
  const { isAdminOrManager, documents } = content;
  const { liveJob } = view;
  return (
    <DetailColumns layout="halves">
      {/* Left Column: Metadata + Client + Employees */}
      <JobDetailMainColumn
        liveJob={liveJob}
        isAdminOrManager={isAdminOrManager}
        canApproveWorkArtifacts={content.canApproveWorkArtifacts}
        currentUserId={content.currentUserId}
        members={content.members}
        metadataFields={view.metadataFields}
        instructionItems={content.instructionItems}
        initialArtifacts={content.initialArtifacts}
        documents={documents}
        timeEntries={view.timeEntries}
        setShowClientDialog={view.dialogs.setShowClientDialog}
        openAssignDialog={view.assignment.openAssignDialog}
        isUnassigning={view.assignment.isUnassigning}
        handleUnassign={view.assignment.handleUnassign}
      />

      {/* Right Column: Project + Placeholders */}
      <JobDetailSideColumn
        liveJob={liveJob}
        projectInfo={view.projectInfo}
        isAdminOrManager={isAdminOrManager}
        documents={documents}
        materialLines={content.materialLines}
        inventoryItems={content.inventoryItems}
        inventoryLocations={content.inventoryLocations}
        isLoadingTime={view.isLoadingTime}
        isTimeStale={view.isTimeStale}
        refreshTime={view.refreshTime}
        timeSummary={view.timeSummary}
        setShowProjectDialog={view.dialogs.setShowProjectDialog}
      />
    </DetailColumns>
  );
}

export function JobDetailContent(props: JobDetailContentProps) {
  const { parentProject, members, isAdminOrManager } = props;
  const view = useJobDetailContentView(props);
  const { liveJob, displayTitle, dialogs, projectInfo } = view;

  return (
    <PageShell>
      <JobDetailHeader
        liveJob={liveJob}
        projectInfo={projectInfo}
        displayTitle={displayTitle}
        isJobActive={view.isJobActive}
        isAdminOrManager={isAdminOrManager}
        handleEditDialogOpenChange={dialogs.handleEditDialogOpenChange}
        setShowDeleteDialog={dialogs.setShowDeleteDialog}
      />

      <PageBody>
        <UsableContent name="auftrag">
          <JobDetailOverview
            liveJob={liveJob}
            parentProject={parentProject}
            displayTitle={displayTitle}
            isAdminOrManager={isAdminOrManager}
            lifecycleSnapshot={props.lifecycleSnapshot}
            handoverWorkspace={props.handoverWorkspace}
            originRequest={props.originRequest}
          />
          <JobDetailContentColumns content={props} view={view} />
        </UsableContent>
      </PageBody>

      <JobDetailContentDialogs
        dialogs={dialogs}
        liveJob={liveJob}
        parentProject={parentProject}
        projectInfo={projectInfo}
        displayTitle={displayTitle}
        members={members}
        assignment={view.assignment}
        applyLiveJobPatch={view.applyLiveJobPatch}
        isDeletingRef={view.isDeletingRef}
        suppressRefreshRef={view.suppressRefreshRef}
        inlineEditWarningDialog={view.inlineEditWarningDialog}
      />
    </PageShell>
  );
}
