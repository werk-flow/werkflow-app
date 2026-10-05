'use client';

import { useMemo } from 'react';
import { Building2, FolderOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { MetadataSection, type MetadataField } from '@/components/shared/metadata-section';
import { EntityLinkCard } from '@/components/shared/entity-link-card';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { ApplyWorkTemplateCard } from '@/components/arbeitsvorlagen/apply-work-template-card';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import {
  type JobWithDetails,
  type JobInstructionItemWithDetails,
  CLIENT_TYPE_LABELS,
} from '@/lib/jobs/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { InventoryLocation, InventoryPickerOption, JobMaterialLine } from '@/lib/inventory/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { JobInstructionItemsCard } from '../instructions/job-instruction-items-card';
import { JobQualificationSection } from './job-qualification-section';
import { JobDispatchSection } from './job-dispatch-section';
import { WorkArtifactsSection } from '../artifacts/work-artifacts-section';
import { JobDetailAssigneesCard } from './job-detail-assignees-card';
import { JobDetailTimeCard } from './job-detail-time-card';
import type { JobDetailTimeSummary } from './use-job-detail-time-summary';
import { formatGermanDateTime } from '@/lib/utils';

type JobDetailMainColumnProps = {
  liveJob: JobWithDetails;
  isAdminOrManager: boolean;
  canApproveWorkArtifacts: boolean;
  currentUserId: string;
  members: OrgMemberOption[];
  metadataFields: MetadataField[];
  // Null: the server read failed, and the region shows the failure.
  instructionItems: JobInstructionItemWithDetails[] | null;
  initialArtifacts: WorkArtifactSummary[] | null;
  documents: OrganizationDocument[] | null;
  timeEntries: TimeEntry[];
  setShowClientDialog: (open: boolean) => void;
  openAssignDialog: () => void;
  isUnassigning: (userId: string) => boolean;
  handleUnassign: (userId: string) => Promise<void>;
};

/** Left column: details, instructions, work evidence, customer and assigned employees. */
export function JobDetailMainColumn({
  liveJob,
  isAdminOrManager,
  canApproveWorkArtifacts,
  currentUserId,
  members,
  metadataFields,
  instructionItems,
  initialArtifacts,
  documents,
  timeEntries,
  setShowClientDialog,
  openAssignDialog,
  isUnassigning,
  handleUnassign,
}: JobDetailMainColumnProps) {
  const currentUserActor = useMemo(() => {
    const currentMember = members.find((member) => member.userId === currentUserId);

    if (currentMember) {
      return {
        userId: currentMember.userId,
        firstName: currentMember.firstName || null,
        lastName: currentMember.lastName || null,
        email: null,
        avatarPath: null,
      };
    }

    const currentAssignment = liveJob.assignments.find((assignment) => assignment.userId === currentUserId);

    if (!currentAssignment) return null;

    return {
      userId: currentAssignment.userId,
      firstName: currentAssignment.firstName,
      lastName: currentAssignment.lastName,
      email: currentAssignment.email,
      avatarPath: currentAssignment.avatarPath,
    };
  }, [currentUserId, liveJob.assignments, members]);
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
      timeEntries
        .filter((entry) => entry.jobId === liveJob.id && entry.entryType === 'clock_in')
        .map((entry) => ({
          id: entry.canonicalSegmentId ?? entry.id,
          label: formatGermanDateTime(entry.timestamp),
          sourceType: entry.canonicalSegmentId ? ('time_segment' as const) : ('time_entry' as const),
        })),
    [liveJob.id, timeEntries],
  );

  return (
    <div className="space-y-6">
      <MetadataSection title="Details" fields={metadataFields} isEditable={isAdminOrManager} />

      {instructionItems ? (
        <JobInstructionItemsCard
          jobId={liveJob.id}
          initialItems={instructionItems}
          isAdminOrManager={isAdminOrManager}
          currentUserActor={currentUserActor}
        />
      ) : (
        <RegionLoadError>Arbeitsanweisungen konnten nicht geladen werden.</RegionLoadError>
      )}

      {initialArtifacts ? (
        <WorkArtifactsSection
          targetType="job"
          targetId={liveJob.id}
          initialArtifacts={initialArtifacts}
          isManager={isAdminOrManager}
          canApprove={canApproveWorkArtifacts}
          currentUserId={currentUserId}
          documents={documents ?? []}
          evidenceRequirements={artifactEvidenceRequirements}
          instructionOptions={artifactInstructionOptions}
          defaultSiteId={liveJob.site?.id}
          timeEntryOptions={artifactTimeEntryOptions}
        />
      ) : (
        <RegionLoadError>Arbeitsnachweise konnten nicht geladen werden.</RegionLoadError>
      )}

      {isAdminOrManager && <ApplyWorkTemplateCard targetType="job" targetId={liveJob.id} />}

      {liveJob.client ? (
        <EntityLinkCard
          title={liveJob.client.name}
          href={`/kunden/${liveJob.client.id}`}
          icon={<Building2 className="size-5" />}
          badge={
            <Badge variant="outline" className="text-xs">
              {CLIENT_TYPE_LABELS[liveJob.client.clientType]}
            </Badge>
          }
          metadata={[
            ...(liveJob.client.email ? [{ label: 'E-Mail', value: liveJob.client.email }] : []),
            ...(liveJob.client.phone ? [{ label: 'Telefon', value: liveJob.client.phone }] : []),
          ]}
        />
      ) : (
        <EntityLinkCard
          title=""
          href=""
          icon={<Building2 className="size-5" />}
          emptyState={{ text: 'Kein Kunde zugewiesen' }}
          onEmptyClick={isAdminOrManager ? () => setShowClientDialog(true) : undefined}
        />
      )}

      {/* Assigned Employees */}
      <JobDetailAssigneesCard
        assignments={liveJob.assignments}
        isAdminOrManager={isAdminOrManager}
        openAssignDialog={openAssignDialog}
        isUnassigning={isUnassigning}
        handleUnassign={handleUnassign}
      />
    </div>
  );
}

type JobDetailSideColumnProps = {
  liveJob: JobWithDetails;
  projectInfo: JobWithDetails['project'];
  isAdminOrManager: boolean;
  // Null: the server read failed, and the region shows the failure.
  documents: OrganizationDocument[] | null;
  materialLines: JobMaterialLine[] | null;
  inventoryItems: InventoryPickerOption[] | null;
  inventoryLocations: InventoryLocation[] | null;
  isLoadingTime: boolean;
  timeSummary: JobDetailTimeSummary;
  setShowProjectDialog: (open: boolean) => void;
};

/** Right column: project, dispatch, materials, qualifications, documents and recorded time. */
export function JobDetailSideColumn({
  liveJob,
  projectInfo,
  isAdminOrManager,
  documents,
  materialLines,
  inventoryItems,
  inventoryLocations,
  isLoadingTime,
  timeSummary,
  setShowProjectDialog,
}: JobDetailSideColumnProps) {
  return (
    <div className="space-y-6">
      {projectInfo?.projectNumber ? (
        <EntityLinkCard
          title={projectInfo.name}
          href={`/auftraege/projekt/${encodeURIComponent(projectInfo.projectNumber)}`}
          icon={<FolderOpen className="size-5" />}
          metadata={[
            {
              label: 'Projektnummer',
              value: projectInfo.projectNumber,
            },
          ]}
        />
      ) : (
        <EntityLinkCard
          title=""
          href=""
          icon={<FolderOpen className="size-5" />}
          emptyState={{ text: 'Keinem Projekt zugeordnet' }}
          onEmptyClick={isAdminOrManager ? () => setShowProjectDialog(true) : undefined}
        />
      )}

      <JobDispatchSection jobId={liveJob.id} />

      {materialLines && inventoryItems && inventoryLocations ? (
        <JobMaterialsSection
          jobId={liveJob.id}
          initialLines={materialLines}
          inventoryItems={inventoryItems}
          locations={inventoryLocations}
          isAdminOrManager={isAdminOrManager}
        />
      ) : (
        <RegionLoadError>Material und Inventar konnten nicht geladen werden.</RegionLoadError>
      )}
      {isAdminOrManager && <JobQualificationSection jobId={liveJob.id} canEdit={isAdminOrManager} />}

      {documents ? (
        <ContextualDocumentsSection
          title="Dokumente & Bilder"
          description="Lade Dateien zu diesem Auftrag hoch oder verknüpfe vorhandene Dokumente."
          documents={documents}
          documentTarget={{ kind: 'job', jobId: liveJob.id }}
          contextLabel={liveJob.title}
          canUpload
          canManage={isAdminOrManager}
        />
      ) : (
        <RegionLoadError>Dokumente und Bilder konnten nicht geladen werden.</RegionLoadError>
      )}

      {/* Zeiterfassung und Aktivität */}
      <JobDetailTimeCard
        isLoadingTime={isLoadingTime}
        progressTargetMinutes={liveJob.plannedWorkingMinutes}
        timeSummary={timeSummary}
      />
    </div>
  );
}
