// Isolated stand-in for `@/lib/data/background-read-client`: the fixtures own
// the reads their components perform; any other kind is a contract violation.
import { readPlanningOptionContract } from './planning-option-service-boundaries';
import { readEntityOptionContract } from './option-service-boundaries';
import { readTimeCorrectionFormOptionsContract } from './calendar-views-service-boundaries';
import { getWorkLifecycleSnapshot } from './lifecycle-boundaries';
import { readApprovalContract } from './approval-service-boundaries';
import { readTimeApprovalContract } from './time-approval-boundaries';
import { readMaterialLinesContract, readMaterialPickerContract } from './material-boundaries';
import { getOwnPersonnelActions, getPersonnelLifecycle } from './personnel-boundaries';
import { readAffectedVisitsContract } from './absence-service-boundaries';
import { readPlannedVisitsContract } from './correction-timeline-boundaries';
import { readSignatureViewContract, readWorkArtifactDetailContract } from './work-artifact-boundaries';
import { readRequestWorkTargetsContract } from './request-attach-boundaries';
import { absenceAffectedVisitsInputSchema } from '@/lib/calendar/absence-visits-types';

export async function readInBackground(kind: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  if (kind === 'planning-options') return readPlanningOptionContract(input, signal);
  if (kind === 'entity-options') return readEntityOptionContract(input);
  if (kind === 'next-request-number') return { success: true, requestNumber: 'ANF-2026-0001' };
  if (kind === 'request-work-targets') return readRequestWorkTargetsContract(input);
  if (kind === 'time-correction-form-options') return readTimeCorrectionFormOptionsContract();
  if (kind === 'work-lifecycle-snapshot') return getWorkLifecycleSnapshot();
  if (kind === 'pending-vacation-for-approver' || kind === 'decidable-approved-vacation')
    return readApprovalContract(kind);
  if (
    kind === 'pending-sessions' ||
    kind === 'pending-change-requests' ||
    kind === 'time-correction-requests'
  )
    return readTimeApprovalContract(kind);
  if (kind === 'time-correction-planned-visits') return readPlannedVisitsContract(input);
  if (kind === 'job-material-lines') return readMaterialLinesContract();
  if (kind === 'inventory-picker-page' || kind === 'job-inventory-picker-options')
    return readMaterialPickerContract();
  if (kind === 'absence-affected-visits')
    return readAffectedVisitsContract(absenceAffectedVisitsInputSchema.parse(input));
  if (kind === 'work-artifact-detail') return readWorkArtifactDetailContract();
  if (kind === 'document-view-url') return readSignatureViewContract();
  if (kind === 'own-personnel-actions') return getOwnPersonnelActions();
  if (kind === 'personnel-lifecycle' && input && typeof input === 'object' && 'employeeRecordId' in input)
    return getPersonnelLifecycle(String(input.employeeRecordId));
  // The job edit dialog's assignment reads stay in flight: its focus contract
  // asserts the dialog as it opens, before they answer.
  if (kind === 'job-details' || kind === 'assignment-team-options') return new Promise(() => undefined);
  throw new Error(`Unexpected background read in the UI fixture: ${kind} ${JSON.stringify(input)}`);
}
