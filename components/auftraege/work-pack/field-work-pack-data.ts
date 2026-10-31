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
import { getTimeEntriesForJob } from '@/lib/time-tracking/entry-read-actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';
import { getWorkHandoverFieldStatus } from '@/lib/work-handover/actions';
import { getAssignedEquipmentForJob } from '@/lib/installed-equipment/actions';
import { getAssignedServiceContextForJob } from '@/lib/service-cases/actions';
import { getAssignedMaintenanceContextForJob } from '@/lib/maintenance/actions';
import { formatBerlinDateTime } from '@/lib/utils';

type FieldWorkPackAssignment = JobWithDetails['assignments'][number];

/** The job's material lines as the field sees them: never billable. */
function fieldMaterialLines(materialLinesResult: Awaited<ReturnType<typeof getJobMaterialLines>>) {
  return materialLinesResult.success
    ? materialLinesResult.lines.map((line) => ({
        ...line,
        billableQuantity: 0,
        isBillable: false,
      }))
    : [];
}

/** The signed-in assignee as an instruction actor. */
function fieldWorkPackActor(
  currentUserId: string,
  currentUserAssignment: FieldWorkPackAssignment,
): JobInstructionActor {
  return {
    userId: currentUserId,
    firstName: currentUserAssignment.firstName,
    lastName: currentUserAssignment.lastName,
    email: null,
    avatarPath: null,
  };
}

/** The clock-ins on this job that evidence can name as its time source. */
function fieldTimeEntryOptions(timeEntries: TimeEntry[], jobId: string) {
  return timeEntries
    .filter((entry) => entry.entryType === 'clock_in' && entry.jobId === jobId)
    .map((entry) => ({
      id: entry.canonicalSegmentId ?? entry.id,
      sourceType: entry.canonicalSegmentId ? ('time_segment' as const) : ('time_entry' as const),
      label: formatBerlinDateTime(entry.timestamp),
    }));
}

/** Every source of the field work pack, read in parallel, with the values the page derives from them. */
export async function loadFieldWorkPackData(
  job: JobWithDetails,
  currentUserId: string,
  currentUserAssignment: FieldWorkPackAssignment,
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
  const materialLines = fieldMaterialLines(materialLinesResult);
  const timeEntries = timeResult.success
    ? timeResult.entries.filter((entry) => entry.userId === currentUserId)
    : [];
  const currentUserActor = fieldWorkPackActor(currentUserId, currentUserAssignment);
  const readOnly = lifecycleResult.success
    ? isFieldWorkPackReadOnly(lifecycleResult.snapshot.executionState)
    : true;
  const dispatchCards = dispatchResult.success ? dispatchResult.cards : undefined;
  const evidenceRequirements = instructionItems.flatMap((item) => item.evidenceRequirements);
  const timeEntryOptions = fieldTimeEntryOptions(timeEntries, job.id);

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
