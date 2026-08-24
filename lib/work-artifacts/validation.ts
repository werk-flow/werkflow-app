import { z } from 'zod';
import { WORK_ARTIFACT_KINDS, type WorkArtifactActionType } from './types';

const optionalText = z.string().trim().max(5000).optional();
const optionalUuid = z.string().uuid().optional();

const workArtifactContentSchema = z.object({
  siteId: optionalUuid,
  instructionItemId: optionalUuid,
  summary: optionalText,
  customerStatement: optionalText,
  requiresCustomerResponse: z.boolean().optional(),
  requiresSignature: z.boolean().optional(),
  workDate: z.string().date().optional(),
  progress: optionalText,
  peoplePresent: optionalText,
  weatherConditions: optionalText,
  siteConditions: optionalText,
  deliveries: optionalText,
  impediments: optionalText,
  decisions: optionalText,
  notableEvents: optionalText,
  visitStartedAt: z.string().datetime({ offset: true }).optional(),
  visitEndedAt: z.string().datetime({ offset: true }).optional(),
  performedWork: optionalText,
  outstandingWork: optionalText,
  materialsSummary: optionalText,
  nextVisitAt: z.string().datetime({ offset: true }).optional(),
  measurementDate: z.string().date().optional(),
  measurementLocation: z.string().trim().max(500).optional(),
  measurementNotes: optionalText,
  measurementLines: z.array(z.object({
    id: optionalUuid,
    description: z.string().trim().min(1).max(500),
    location: z.string().trim().max(500).optional(),
    quantity: z.string().regex(/^\d{1,11}(?:[.,]\d{1,3})?$/)
      .refine((value) => Number(value.replace(',', '.')) > 0, 'quantity_must_be_positive'),
    unit: z.enum(['piece', 'meter', 'square_meter', 'cubic_meter', 'liter', 'kilogram', 'hour', 'flat_rate']),
    note: z.string().trim().max(1000).optional(),
  })).max(200).optional(),
  defectDescription: optionalText,
  defectSeverity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  defectLocation: z.string().trim().max(500).optional(),
  responsibleEmployeeRecordId: optionalUuid,
  responsibilityContext: z.string().trim().max(1000).optional(),
  dueDate: z.string().date().optional(),
  defectState: z.enum(['open', 'in_progress', 'resolved']).optional(),
  proposedResolution: optionalText,
  resolutionSummary: optionalText,
  changeDescription: optionalText,
  changeReason: z.string().trim().max(2000).optional(),
  requestedByContext: z.string().trim().max(500).optional(),
  expectedLaborMinutes: z.string().regex(/^\d{1,10}$/)
    .refine((value) => Number(value) <= 2_147_483_647, 'labor_minutes_out_of_range').optional(),
  actualLaborMinutes: z.string().regex(/^\d{1,10}$/)
    .refine((value) => Number(value) <= 2_147_483_647, 'labor_minutes_out_of_range').optional(),
  expectedMaterialSummary: optionalText,
  actualMaterialSummary: optionalText,
  authorizationState: z.enum(['not_requested', 'requested', 'authorized', 'rejected']).optional(),
  scheduleImpact: optionalText,
}).superRefine((content, context) => {
  if (content.visitStartedAt && content.visitEndedAt
    && new Date(content.visitEndedAt) <= new Date(content.visitStartedAt)) {
    context.addIssue({ code: 'custom', path: ['visitEndedAt'], message: 'visit_end_must_be_after_start' });
  }
});

export const saveWorkArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative().nullable(),
  targetType: z.enum(['job', 'project']),
  targetId: z.string().uuid(),
  kind: z.enum(WORK_ARTIFACT_KINDS),
  visibility: z.enum(['internal_only', 'customer_facing']),
  capturedAt: z.string().datetime({ offset: true }),
  title: z.string().trim().min(3).max(160),
  content: workArtifactContentSchema,
  correctsRevisionId: optionalUuid,
  correctionReason: z.string().trim().min(3).max(1000).optional(),
  submit: z.boolean(),
  submitActionId: optionalUuid,
}).superRefine((value, context) => {
  const content = value.content;
  const meaningful = value.kind === 'site_diary' ? content.progress
    : value.kind === 'work_report' ? content.performedWork
      : value.kind === 'measurement' ? content.measurementLocation || content.measurementLines?.length
        : value.kind === 'defect' ? content.defectDescription
          : content.changeDescription;
  if (!meaningful) context.addIssue({ code: 'custom', path: ['content'], message: 'meaningful_content_required' });
  if (value.kind === 'defect') {
    if (!content.defectSeverity) context.addIssue({ code: 'custom', path: ['content', 'defectSeverity'], message: 'defect_severity_required' });
    if (!content.defectLocation) context.addIssue({ code: 'custom', path: ['content', 'defectLocation'], message: 'defect_location_required' });
  }
  if (value.kind === 'change_work') {
    if (!content.changeReason) context.addIssue({ code: 'custom', path: ['content', 'changeReason'], message: 'change_reason_required' });
    if (!content.requestedByContext) context.addIssue({ code: 'custom', path: ['content', 'requestedByContext'], message: 'requested_by_context_required' });
  }
  if (value.visibility === 'internal_only' && (content.requiresCustomerResponse || content.requiresSignature)) {
    context.addIssue({ code: 'custom', path: ['visibility'], message: 'customer_visibility_required' });
  }
  if (value.submit && !value.submitActionId) {
    context.addIssue({ code: 'custom', path: ['submitActionId'], message: 'submit_action_required' });
  }
  if (value.submit && value.kind === 'site_diary') {
    if (!content.workDate) context.addIssue({ code: 'custom', path: ['content', 'workDate'], message: 'work_date_required' });
    if (!content.progress) context.addIssue({ code: 'custom', path: ['content', 'progress'], message: 'progress_required' });
  }
  if (value.submit && value.kind === 'work_report') {
    if (!content.visitStartedAt) context.addIssue({ code: 'custom', path: ['content', 'visitStartedAt'], message: 'visit_start_required' });
    if (!content.visitEndedAt) context.addIssue({ code: 'custom', path: ['content', 'visitEndedAt'], message: 'visit_end_required' });
    if (!content.performedWork) context.addIssue({ code: 'custom', path: ['content', 'performedWork'], message: 'performed_work_required' });
  }
  if (value.submit && value.kind === 'measurement') {
    if (!content.measurementDate) context.addIssue({ code: 'custom', path: ['content', 'measurementDate'], message: 'measurement_date_required' });
    if (!content.measurementLocation) context.addIssue({ code: 'custom', path: ['content', 'measurementLocation'], message: 'measurement_location_required' });
    if (!content.measurementLines?.length) context.addIssue({ code: 'custom', path: ['content', 'measurementLines'], message: 'measurement_lines_required' });
  }
  if (Boolean(value.correctsRevisionId) !== Boolean(value.correctionReason)) {
    context.addIssue({ code: 'custom', path: ['correctsRevisionId'], message: 'correction_pair_required' });
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'correction_pair_required' });
  }
});

export const voidWorkArtifactSchema = z.object({
  artifactId: z.string().uuid(), actionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(2000),
});

export const workArtifactActionSchema = z.object({
  artifactId: z.string().uuid(), revisionId: z.string().uuid(), actionId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actionType: z.enum(['review_requested', 'review_withdrawn', 'internal_approved', 'internal_rejected',
    'correction_requested', 'customer_acknowledged', 'customer_refused', 'customer_reserved',
    'signature_captured', 'exported', 'voided']),
  reason: z.string().trim().min(3).max(2000).optional(), comment: optionalText,
  customerContext: z.object({
    signerName: z.string().trim().min(2).max(200), signerRole: z.string().trim().max(200).optional(),
    signerRelationship: z.string().trim().min(1).max(200), companyContext: z.string().trim().max(500).optional(),
    captureMethod: z.string().trim().min(1).max(100), wordingSnapshot: z.string().trim().min(3).max(5000),
    witnessContext: z.string().trim().max(500).optional(),
  }).optional(),
  signatureDocumentId: optionalUuid,
}).superRefine((value, context) => {
  const reasonRequired: WorkArtifactActionType[] = [
    'internal_rejected', 'correction_requested', 'customer_refused', 'customer_reserved', 'voided',
  ];
  const customerContextRequired: WorkArtifactActionType[] = [
    'customer_acknowledged', 'customer_refused', 'customer_reserved', 'signature_captured',
  ];
  if (reasonRequired.includes(value.actionType) && !value.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' });
  }
  if (customerContextRequired.includes(value.actionType) && !value.customerContext) {
    context.addIssue({ code: 'custom', path: ['customerContext'], message: 'customer_context_required' });
  }
  if (value.actionType === 'signature_captured' && !value.signatureDocumentId) {
    context.addIssue({ code: 'custom', path: ['signatureDocumentId'], message: 'signature_document_required' });
  }
  if (value.signatureDocumentId && value.actionType !== 'signature_captured') {
    context.addIssue({ code: 'custom', path: ['signatureDocumentId'], message: 'signature_action_required' });
  }
});
