import 'server-only';

import { z } from '@/lib/zod';

import { getAttentionOverview } from '@/lib/attention/actions';
import { getClientRelations } from '@/lib/clients/actions';
import { getDispatchOverview, getJobDispatchCards, previewDispatchReadiness } from '@/lib/dispatch/actions';
import { attachableDocumentsInputSchema } from '@/lib/documents/action-schemas';
import { getAttachableDocuments, getMaintenanceCoverageDocuments } from '@/lib/documents/actions';
import { pickerSearchSchema } from '@/lib/inventory/action-schemas';
import {
  getInventoryPickerOptionsForJob,
  getInventoryPickerPage,
  getJobMaterialLines,
} from '@/lib/inventory/actions';
import { equipmentListQuerySchema } from '@/lib/installed-equipment/list-page';
import { getInstalledEquipmentDetailByNumber } from '@/lib/installed-equipment/actions';
import { getInstalledEquipmentPage } from '@/lib/installed-equipment/list-page-server';
import { getEquipmentSourceOptions } from '@/lib/installed-equipment/source-options-server';
import { getOrgMembersAction, getProfilesByIds } from '@/lib/members/actions';
import { getParkedJobs } from '@/lib/jobs/actions';
import { readEntityOptions } from '@/lib/jobs/option-server';
import { jobOptionRequestSchema } from '@/lib/jobs/option-types';
import { getJobParkingContexts, getParkingResponsibleOptions } from '@/lib/parking/actions';
import { getPlanningOptions } from '@/lib/planning/actions';
import { planningOptionRequestSchema } from '@/lib/planning/option-types';
import { getOwnPersonnelActions, getPersonnelLifecycle } from '@/lib/personnel/lifecycle-actions';
import { getWeeklyTargets } from '@/lib/personnel/target-actions';
import { getServiceCaseDetailByNumber, getServiceClientOption } from '@/lib/service-cases/actions';
import { serviceCaseListQuerySchema } from '@/lib/service-cases/list-page';
import { getServiceCasePage } from '@/lib/service-cases/list-page-server';
import { getOwnSicknessReports, getSicknessReportsForRecord } from '@/lib/sickness/actions';
import { getMaintenanceEvidenceOptions, getMaintenanceWorkspace } from '@/lib/maintenance/actions';
import { maintenanceWorkspaceQuerySchema } from '@/lib/maintenance/workspace-page';
import { getAssignmentTeamOptions, getJobQualificationDetail } from '@/lib/qualifications/actions';
import {
  getProvisionalTimeSummary,
  getTimeCorrectionFormOptions,
  getTimeCorrectionHistoryPage,
  getTimeCorrectionRequests,
} from '@/lib/time-corrections/actions';
import {
  getPendingChangeRequests,
  getPendingSessions,
  getTimeEntries,
  getTimeEntriesForJob,
  getTimeEntriesForProjectJobs,
} from '@/lib/time-tracking/actions';
import { getJobsForPicker } from '@/lib/time-tracking/picker-actions';
import { jobPickerRequestSchema } from '@/lib/time-tracking/picker-types';
import {
  getDecidableApprovedVacationRequests,
  getOwnVacationOverview,
  getPendingVacationRequestsForApprover,
} from '@/lib/vacation/actions';
import { uuidSchema } from '@/lib/validation/uuid';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getApprovedArtifactActionsForTarget, getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';
import {
  getPublishedWorkTemplates,
  getWorkTemplate,
  getWorkTemplatePreview,
  getWorkTemplates,
} from '@/lib/work-templates/actions';
import { workTemplatePreviewInputSchema, workTemplateTargetTypeSchema } from '@/lib/work-templates/schemas';

/**
 * The closed set of read-only readers a page may run in the background over
 * `GET /api/background-read` instead of the browser's serialized Server Action
 * queue (pre-Wave-3 step 3, decision D3). Every reader keeps its own identity,
 * membership and subject checks; the route adds cookie identity and the
 * active-organization equality for inputs that name one. Add a kind here, in
 * the client's import inventory test, and nowhere else.
 */
const isoTimestamp = z.string().datetime({ offset: true });
const organizationInput = z.object({ organizationId: uuidSchema });
const jobInput = z.object({ jobId: uuidSchema });
const employeeRecordInput = z.object({ employeeRecordId: uuidSchema });
const targetInput = z.object({ targetType: z.enum(['job', 'project']), targetId: uuidSchema });
const noInput = z.object({});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function defineRead<Input, Result>(
  input: z.ZodType<Input>,
  read: (input: Input) => Promise<Result>,
): {
  input: z.ZodType<Input>;
  read: (input: Input) => Promise<Result>;
} {
  return { input, read };
}

export const BACKGROUND_READS = {
  'planning-options': defineRead(planningOptionRequestSchema, (input) => getPlanningOptions(input)),
  // Every entity picker (customers, projects, jobs, equipment, service cases,
  // inventory items, coverages): one page of a server search plus the labels
  // of the selected ids.
  'entity-options': defineRead(jobOptionRequestSchema, (input) => readEntityOptions(input)),
  'parked-jobs': defineRead(noInput, () => getParkedJobs()),
  'job-parking-contexts': defineRead(noInput, () => getJobParkingContexts()),
  'organization-member-options': defineRead(organizationInput, (input) =>
    getOrgMembersAction(input.organizationId),
  ),
  'time-entries': defineRead(
    z.object({
      organizationId: uuidSchema,
      from: isoTimestamp,
      to: isoTimestamp,
      userId: uuidSchema.optional(),
      status: z.enum(['pending', 'approved', 'rejected', 'pending_delete']).optional(),
    }),
    (input) =>
      getTimeEntries({
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
  ),
  'weekly-targets': defineRead(z.object({ userId: uuidSchema }), (input) => getWeeklyTargets(input)),
  'own-vacation-overview': defineRead(noInput, () => getOwnVacationOverview()),
  'own-sickness-reports': defineRead(noInput, () => getOwnSicknessReports()),
  'provisional-time-summary': defineRead(
    z.object({ organizationId: uuidSchema, userId: uuidSchema }),
    (input) => getProvisionalTimeSummary(input),
  ),
  'profiles-by-ids': defineRead(z.object({ userIds: z.array(uuidSchema).max(1_000) }), (input) =>
    getProfilesByIds(input.userIds),
  ),
  'pending-sessions': defineRead(organizationInput, (input) => getPendingSessions(input.organizationId)),
  'pending-change-requests': defineRead(organizationInput, (input) =>
    getPendingChangeRequests(input.organizationId),
  ),
  'time-correction-requests': defineRead(
    z.object({ organizationId: uuidSchema, scope: z.literal('approvals') }),
    (input) => getTimeCorrectionRequests(input.organizationId, input.scope),
  ),
  // The people of the correction dialog, read when it opens; its job picker is an entity search.
  'time-correction-form-options': defineRead(organizationInput, (input) =>
    getTimeCorrectionFormOptions(input.organizationId),
  ),
  'time-correction-history': defineRead(
    z.object({ organizationId: uuidSchema, page: z.number().int().min(1).max(1_000_000) }),
    (input) => getTimeCorrectionHistoryPage(input.organizationId, input.page),
  ),
  'pending-vacation-for-approver': defineRead(noInput, () => getPendingVacationRequestsForApprover()),
  'decidable-approved-vacation': defineRead(noInput, () => getDecidableApprovedVacationRequests()),
  'time-entries-for-job': defineRead(jobInput, (input) => getTimeEntriesForJob(input.jobId)),
  'project-job-time-entries': defineRead(z.object({ projectId: uuidSchema }), (input) =>
    getTimeEntriesForProjectJobs(input.projectId),
  ),
  'job-dispatch-cards': defineRead(jobInput, (input) => getJobDispatchCards(input.jobId)),
  'dispatch-overview': defineRead(z.object({ from: isoDate, to: isoDate }), (input) =>
    getDispatchOverview(input.from, input.to),
  ),
  'job-qualification-detail': defineRead(jobInput, (input) => getJobQualificationDetail(input.jobId)),
  'job-material-lines': defineRead(jobInput, (input) => getJobMaterialLines(input.jobId)),
  'work-artifacts': defineRead(targetInput, (input) => getWorkArtifacts(input)),
  'work-lifecycle-snapshot': defineRead(targetInput, (input) => getWorkLifecycleSnapshot(input)),
  // Live list pages refresh through the reader of their first render; the
  // route checks the organization, and the reader parses the query again.
  'equipment-page': defineRead(equipmentListQuerySchema.extend({ organizationId: uuidSchema }), (input) =>
    getInstalledEquipmentPage(input),
  ),
  'service-case-page': defineRead(
    serviceCaseListQuerySchema.extend({ organizationId: uuidSchema }),
    (input) => getServiceCasePage(input),
  ),
  // Case and equipment numbers repeat across organizations, so a detail read
  // names its organization and an organization switch refuses it.
  // The sites, contacts and equipment of the one customer a service form chose.
  'service-client-option': defineRead(
    z.object({ organizationId: uuidSchema, clientId: uuidSchema }),
    (input) => getServiceClientOption(input.clientId),
  ),
  'service-case-detail': defineRead(
    z.object({ organizationId: uuidSchema, caseNumber: z.string().trim().min(1).max(100) }),
    (input) => getServiceCaseDetailByNumber(input.caseNumber),
  ),
  'equipment-detail': defineRead(
    z.object({ organizationId: uuidSchema, equipmentNumber: z.string().trim().min(1).max(100) }),
    (input) => getInstalledEquipmentDetailByNumber(input.equipmentNumber),
  ),
  // The exact sources of one equipment: the revisions and releases of the one
  // job or project its source dialog chose, or without one its own documents.
  'equipment-sources': defineRead(
    z.object({
      organizationId: uuidSchema,
      equipmentId: uuidSchema,
      work: z.object({ type: z.enum(['job', 'project']), id: uuidSchema }).nullable(),
    }),
    (input) => getEquipmentSourceOptions(input),
  ),
  'attention-overview': defineRead(noInput, () => getAttentionOverview()),
  'own-personnel-actions': defineRead(noInput, () => getOwnPersonnelActions()),
  'personnel-lifecycle': defineRead(employeeRecordInput, (input) =>
    getPersonnelLifecycle(input.employeeRecordId),
  ),
  'sickness-reports-for-record': defineRead(employeeRecordInput, (input) =>
    getSicknessReportsForRecord(input.employeeRecordId),
  ),
  'job-picker-jobs': defineRead(jobPickerRequestSchema, (input) => getJobsForPicker(input)),
  'maintenance-workspace': defineRead(
    maintenanceWorkspaceQuerySchema.extend({ organizationId: uuidSchema }),
    (input) => getMaintenanceWorkspace(input),
  ),
  'work-templates': defineRead(noInput, () => getWorkTemplates()),
  'work-template-detail': defineRead(z.object({ templateId: uuidSchema }), (input) =>
    getWorkTemplate(input.templateId),
  ),
  // Option, entity and preview reads a dialog or picker starts when it opens.
  'published-work-templates': defineRead(z.object({ targetType: workTemplateTargetTypeSchema }), (input) =>
    getPublishedWorkTemplates(input.targetType),
  ),
  'work-template-preview': defineRead(workTemplatePreviewInputSchema, (input) =>
    getWorkTemplatePreview(input),
  ),
  'approved-artifact-actions': defineRead(targetInput, (input) => getApprovedArtifactActionsForTarget(input)),
  'assignment-team-options': defineRead(noInput, () => getAssignmentTeamOptions()),
  'client-relations': defineRead(z.object({ clientId: uuidSchema }), (input) =>
    getClientRelations(input.clientId),
  ),
  'attachable-documents': defineRead(attachableDocumentsInputSchema, (input) =>
    getAttachableDocuments(input),
  ),
  // The first unsearched office page sets up the inventory defaults, a write
  // that stays with the page render; the background read only searches or
  // resolves one item.
  'inventory-picker-page': defineRead(
    z
      .object({ search: pickerSearchSchema, exactItemId: uuidSchema.optional() })
      .refine((input) => input.search !== '' || input.exactItemId !== undefined),
    (input) => getInventoryPickerPage(input.search, input.exactItemId),
  ),
  'job-inventory-picker-options': defineRead(
    z.object({ jobId: uuidSchema, search: pickerSearchSchema, exactItemId: uuidSchema.optional() }),
    (input) => getInventoryPickerOptionsForJob(input.jobId, input.search, input.exactItemId),
  ),
  'dispatch-readiness': defineRead(
    z.union([z.strictObject({ jobId: uuidSchema }), z.strictObject({ occurrenceId: uuidSchema })]),
    (input) => previewDispatchReadiness(input),
  ),
  'parking-responsible-options': defineRead(noInput, () => getParkingResponsibleOptions()),
  'maintenance-coverage-documents': defineRead(z.object({ maintenanceCoverageId: uuidSchema }), (input) =>
    getMaintenanceCoverageDocuments(input.maintenanceCoverageId),
  ),
  'maintenance-evidence-options': defineRead(jobInput, (input) => getMaintenanceEvidenceOptions(input.jobId)),
} as const;

export type BackgroundReadKind = keyof typeof BACKGROUND_READS;
export type BackgroundReadInput<Kind extends BackgroundReadKind> = z.infer<
  (typeof BACKGROUND_READS)[Kind]['input']
>;
export type BackgroundReadResult<Kind extends BackgroundReadKind> = Awaited<
  ReturnType<(typeof BACKGROUND_READS)[Kind]['read']>
>;

export function isBackgroundReadKind(value: string): value is BackgroundReadKind {
  return Object.hasOwn(BACKGROUND_READS, value);
}
