'use client';

import type { OriginRequestLink } from '../shared/origin-request-line';
import { useState, useCallback, useMemo, useRef } from 'react';
import { useActiveJobs } from '@/hooks/use-active-jobs';

import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UsableContent } from '@/components/shared/usable-content';
import { QualificationWarningDialog } from '../shared/qualification-warning-dialog';
import { EditJobDialog } from '../forms/edit-job-dialog';
import { knownProjectOption } from '../forms/job-form-options';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';

import { readInBackground } from '@/lib/data/background-read-client';
import type { TimeEntry } from '@/lib/time-tracking/types';
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
import { JobDetailAssignDialog } from './job-detail-assign-dialog-sections';
import { JobDetailMainColumn, JobDetailSideColumn } from './job-detail-columns';
import { JobDetailDeleteDialog } from './job-detail-delete-dialog';
import { JobDetailHeader } from './job-detail-header';
import { JobDetailOverview } from './job-detail-overview';
import { JobDetailRelationDialogs } from './job-detail-relation-dialogs';
import type { JobTimeParticipant } from './job-detail-time-sessions';
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

export function JobDetailContent({
  job,
  parentProject,
  members,
  isAdminOrManager,
  canApproveWorkArtifacts,
  instructionItems,
  initialArtifacts,
  documents,
  materialLines,
  inventoryItems,
  inventoryLocations,
  currentUserId,
  lifecycleSnapshot,
  handoverWorkspace,
  originRequest,
}: JobDetailContentProps) {
  const { liveJob, setLiveJob, applyLiveJobPatch } = useJobDetailLiveJob(job);
  const { activeJobIds } = useActiveJobs();
  const displayTitle = getJobDisplayTitle(liveJob);
  const isJobActive = activeJobIds.has(liveJob.id);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  // No refresh on close: updateJob's response renders the route, and a
  // Realtime refresh deferred while the dialog was open runs once it closes.
  const handleEditDialogOpenChange = (open: boolean) => setShowEditDialog(open);
  const assignment = useJobDetailAssignments({
    liveJob,
    setLiveJob,
    dialogMembers: members,
    setShowAssignDialog,
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

  return (
    <PageShell>
      <JobDetailHeader
        liveJob={liveJob}
        projectInfo={projectInfo}
        displayTitle={displayTitle}
        isJobActive={isJobActive}
        isAdminOrManager={isAdminOrManager}
        handleEditDialogOpenChange={handleEditDialogOpenChange}
        setShowDeleteDialog={setShowDeleteDialog}
      />

      <PageBody>
        <UsableContent name="auftrag">
          <JobDetailOverview
            liveJob={liveJob}
            parentProject={parentProject}
            displayTitle={displayTitle}
            isAdminOrManager={isAdminOrManager}
            lifecycleSnapshot={lifecycleSnapshot}
            handoverWorkspace={handoverWorkspace}
            originRequest={originRequest}
          />
          {/* Columns follow the width of this content, not of the screen: the app sidebar takes
              256 px, so a screen breakpoint turned the columns on where they did not fit. */}
          <div className="@container/detail">
            <div className="grid grid-cols-1 gap-6 @4xl/detail:grid-cols-2">
              {/* Left Column: Metadata + Client + Employees */}
              <JobDetailMainColumn
                liveJob={liveJob}
                isAdminOrManager={isAdminOrManager}
                canApproveWorkArtifacts={canApproveWorkArtifacts}
                currentUserId={currentUserId}
                members={members}
                metadataFields={metadataFields}
                instructionItems={instructionItems}
                initialArtifacts={initialArtifacts}
                documents={documents}
                timeEntries={timeEntries}
                setShowClientDialog={setShowClientDialog}
                openAssignDialog={assignment.openAssignDialog}
                isUnassigning={assignment.isUnassigning}
                handleUnassign={assignment.handleUnassign}
              />

              {/* Right Column: Project + Placeholders */}
              <JobDetailSideColumn
                liveJob={liveJob}
                projectInfo={projectInfo}
                isAdminOrManager={isAdminOrManager}
                documents={documents}
                materialLines={materialLines}
                inventoryItems={inventoryItems}
                inventoryLocations={inventoryLocations}
                isLoadingTime={isLoadingTime}
                isTimeStale={isTimeStale}
                refreshTime={refreshTime}
                timeSummary={timeSummary}
                setShowProjectDialog={setShowProjectDialog}
              />
            </div>
          </div>
        </UsableContent>
      </PageBody>

      {/* Delete Dialog */}
      <JobDetailDeleteDialog
        open={showDeleteDialog}
        setShowDeleteDialog={setShowDeleteDialog}
        jobId={liveJob.id}
        displayTitle={displayTitle}
        projectNumber={projectInfo?.projectNumber}
        isDeletingRef={isDeletingRef}
        suppressRefreshRef={suppressRefreshRef}
      />

      {/* Assign Employee Dialog */}
      <JobDetailAssignDialog
        open={showAssignDialog}
        setShowAssignDialog={setShowAssignDialog}
        assignment={assignment}
        members={members}
        assessedForDate={liveJob.plannedDate}
      />

      <JobDetailRelationDialogs
        liveJob={liveJob}
        parentProject={parentProject}
        showClientDialog={showClientDialog}
        setShowClientDialog={setShowClientDialog}
        showProjectDialog={showProjectDialog}
        setShowProjectDialog={setShowProjectDialog}
        applyLiveJobPatch={applyLiveJobPatch}
        suppressRefreshRef={suppressRefreshRef}
      />

      <EditJobDialog
        job={liveJob}
        open={showEditDialog}
        onOpenChange={handleEditDialogOpenChange}
        selectedClient={liveJob.client}
        members={members}
        knownProject={
          projectInfo && liveJob.projectId === projectInfo.id
            ? knownProjectOption({ ...projectInfo, clientId: liveJob.clientId }, liveJob.client?.name ?? null)
            : undefined
        }
        onSuccess={assignment.handleJobEdited}
      />

      <QualificationWarningDialog
        evaluation={assignment.qualificationWarning}
        isSubmitting={assignment.isAssigning || assignment.isQualificationOverrideSaving}
        error={assignment.qualificationOverrideError}
        onCancel={assignment.cancelQualificationWarning}
        onConfirm={assignment.handleQualificationOverride}
      />
      {inlineEditWarningDialog}
    </PageShell>
  );
}
