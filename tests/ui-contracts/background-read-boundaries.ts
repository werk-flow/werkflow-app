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

export async function readInBackground(kind: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  if (kind === 'planning-options') return readPlanningOptionContract(input, signal);
  if (kind === 'entity-options') return readEntityOptionContract(input);
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
  if (kind === 'job-material-lines') return readMaterialLinesContract();
  if (kind === 'inventory-picker-page' || kind === 'job-inventory-picker-options')
    return readMaterialPickerContract();
  if (kind === 'own-personnel-actions') return getOwnPersonnelActions();
  if (kind === 'personnel-lifecycle' && input && typeof input === 'object' && 'employeeRecordId' in input)
    return getPersonnelLifecycle(String(input.employeeRecordId));
  throw new Error(`Unexpected background read in the UI fixture: ${kind} ${JSON.stringify(input)}`);
}
