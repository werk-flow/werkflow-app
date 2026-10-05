import { getJobDispatchCards } from '@/lib/dispatch/actions';
import { getJobDocuments } from '@/lib/documents/actions';
import { getJobMaterialLines } from '@/lib/inventory/actions';
import {
  isFieldWorkPackReadOnly,
  projectFieldWorkPackJob,
  sanitizeFieldInstructionItems,
} from '@/lib/jobs/field-work-pack';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import type { JobInstructionActor, JobWithDetails } from '@/lib/jobs/types';
import { getTimeEntriesForJob } from '@/lib/time-tracking/actions';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';
import { getWorkHandoverFieldStatus } from '@/lib/work-handover/actions';
import { getAssignedEquipmentForJob } from '@/lib/installed-equipment/actions';
import { getAssignedServiceContextForJob } from '@/lib/service-cases/actions';
import { getAssignedMaintenanceContextForJob } from '@/lib/maintenance/actions';

/** Every source of the field work pack, read in parallel, with the values the page derives from them. */
export async function loadFieldWorkPackData(
  job: JobWithDetails,
  currentUserId: string,
  currentUserAssignment: JobWithDetails['assignments'][number],
) {
  const [
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    lifecycleResult,
    artifactsResult,
    timeResult,
    dispatchResult,
    handoverStatusResult,
    equipmentResult,
    serviceContextResult,
    maintenanceContextResult,
  ] = await Promise.all([
    getJobInstructionItems(job.id),
    getJobDocuments(job.id),
    getJobMaterialLines(job.id),
    getWorkLifecycleSnapshot({ targetType: 'job', targetId: job.id }),
    getWorkArtifacts({ targetType: 'job', targetId: job.id }),
    getTimeEntriesForJob(job.id),
    getJobDispatchCards(job.id),
    getWorkHandoverFieldStatus(job.id),
    getAssignedEquipmentForJob(job.id),
    getAssignedServiceContextForJob(job.id),
    getAssignedMaintenanceContextForJob(job.id),
  ]);

  const fieldJob = projectFieldWorkPackJob(job);
  const instructionItems = instructionItemsResult.success
    ? sanitizeFieldInstructionItems(instructionItemsResult.items)
    : [];
  const documents = documentsResult.success ? documentsResult.documents : [];
  const materialLines = materialLinesResult.success
    ? materialLinesResult.lines.map((line) => ({
        ...line,
        billableQuantity: 0,
        isBillable: false,
      }))
    : [];
  const timeEntries = timeResult.success
    ? timeResult.entries.filter((entry) => entry.userId === currentUserId)
    : [];
  const currentUserActor: JobInstructionActor = {
    userId: currentUserId,
    firstName: currentUserAssignment.firstName,
    lastName: currentUserAssignment.lastName,
    email: null,
    avatarPath: null,
  };
  const readOnly = lifecycleResult.success
    ? isFieldWorkPackReadOnly(lifecycleResult.snapshot.executionState)
    : true;
  const dispatchCards = dispatchResult.success ? dispatchResult.cards : undefined;
  const evidenceRequirements = instructionItems.flatMap((item) => item.evidenceRequirements);
  const timeEntryOptions = timeEntries
    .filter((entry) => entry.entryType === 'clock_in' && entry.jobId === job.id)
    .map((entry) => ({
      id: entry.canonicalSegmentId ?? entry.id,
      sourceType: entry.canonicalSegmentId ? ('time_segment' as const) : ('time_entry' as const),
      label: new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(entry.timestamp)),
    }));

  return {
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    lifecycleResult,
    artifactsResult,
    timeResult,
    dispatchResult,
    handoverStatusResult,
    equipmentResult,
    serviceContextResult,
    maintenanceContextResult,
    fieldJob,
    instructionItems,
    documents,
    materialLines,
    timeEntries,
    currentUserActor,
    readOnly,
    dispatchCards,
    evidenceRequirements,
    timeEntryOptions,
  };
}

export type FieldWorkPackData = Awaited<ReturnType<typeof loadFieldWorkPackData>>;
