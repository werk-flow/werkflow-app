import { z } from '@/lib/zod';
import { Constants } from '@/lib/supabase/database.types';
import { uuidSchema } from '@/lib/validation/uuid';
import { workArtifactFieldIssues } from './field-rules';
import { CUSTOMER_DECISION_TYPES, customerDecisionNeedsReason } from './customer-decision';
import {
  WORK_ARTIFACT_DRAFT_PHOTO_LIMIT,
  WORK_ARTIFACT_KINDS,
  type WorkArtifactActionType,
  type WorkArtifactReviewActionType,
} from './types';

const artifactText = z.string().trim().max(5000).optional();
const optionalUuid = uuidSchema.optional();

const workArtifactContentSchema = z.object({
  siteId: optionalUuid,
  instructionItemId: optionalUuid,
  summary: artifactText,
  customerStatement: artifactText,
  requiresCustomerResponse: z.boolean().optional(),
  requiresSignature: z.boolean().optional(),
  workDate: z.string().date().optional(),
  progress: artifactText,
  peoplePresent: artifactText,
  weatherConditions: artifactText,
  siteConditions: artifactText,
  deliveries: artifactText,
  impediments: artifactText,
  decisions: artifactText,
  notableEvents: artifactText,
  visitStartedAt: z.string().datetime({ offset: true }).optional(),
  visitEndedAt: z.string().datetime({ offset: true }).optional(),
  performedWork: artifactText,
  outstandingWork: artifactText,
  materialsSummary: artifactText,
  nextVisitAt: z.string().datetime({ offset: true }).optional(),
  measurementDate: z.string().date().optional(),
  measurementLocation: z.string().trim().max(500).optional(),
  measurementNotes: artifactText,
  measurementLines: z
    .array(
      z.object({
        id: optionalUuid,
        description: z.string().trim().max(500),
        location: z.string().trim().max(500).optional(),
        // Format and „above zero“ are a field rule (field-rules.ts), so the form marks the field too.
        quantity: z.string().max(20),
        unit: z.enum(Constants.public.Enums.work_artifact_measurement_unit),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .max(200)
    .optional(),
  defectDescription: artifactText,
  defectSeverity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  defectLocation: z.string().trim().max(500).optional(),
  responsibleEmployeeRecordId: optionalUuid,
  responsibilityContext: z.string().trim().max(1000).optional(),
  dueDate: z.string().date().optional(),
  defectState: z.enum(['open', 'in_progress', 'resolved']).optional(),
  proposedResolution: artifactText,
  resolutionSummary: artifactText,
  changeDescription: artifactText,
  changeReason: z.string().trim().max(2000).optional(),
  requestedByContext: z.string().trim().max(500).optional(),
  expectedLaborMinutes: z
    .string()
    .regex(/^\d{1,10}$/)
    .refine((value) => Number(value) <= 2_147_483_647, 'labor_minutes_out_of_range')
    .optional(),
  actualLaborMinutes: z
    .string()
    .regex(/^\d{1,10}$/)
    .refine((value) => Number(value) <= 2_147_483_647, 'labor_minutes_out_of_range')
    .optional(),
  expectedMaterialSummary: artifactText,
  actualMaterialSummary: artifactText,
  authorizationState: z.enum(['not_requested', 'requested', 'authorized', 'rejected']).optional(),
  scheduleImpact: artifactText,
});

const saveWorkArtifactFields = z.object({
  artifactId: uuidSchema,
  revisionId: uuidSchema,
  expectedVersion: z.number().int().nonnegative().nullable(),
  targetType: z.enum(['job', 'project']),
  targetId: uuidSchema,
  kind: z.enum(WORK_ARTIFACT_KINDS),
  visibility: z.enum(['internal_only', 'customer_facing']),
  capturedAt: z.string().datetime({ offset: true }),
  title: z.string().trim().max(160),
  content: workArtifactContentSchema,
  correctsRevisionId: optionalUuid,
  correctionReason: z.string().trim().min(3).max(1000).optional(),
  submit: z.boolean(),
  submitActionId: optionalUuid,
  /**
   * The device's last-change time of the draft this save comes from, when it comes from one: the
   * attach of that draft adopts this revision only for the same value (decision record 0010).
   */
  draftChangedAt: z.string().datetime({ offset: true }).optional(),
});

type WorkArtifactRuleInput = Pick<
  z.infer<typeof saveWorkArtifactFields>,
  'kind' | 'title' | 'content' | 'visibility' | 'submit'
>;

/** Where a refinement reports a broken rule: the part of Zod's refinement context the rules use. */
type RuleIssueSink = {
  addIssue: (issue: { code: 'custom'; path: Array<string | number>; message: string }) => void;
};

/** The title, the kind's required fields, the visit window and the visibility rule: what the editor marks before a save. */
function addFieldRuleIssues(value: WorkArtifactRuleInput, context: RuleIssueSink): void {
  for (const issue of workArtifactFieldIssues(value)) {
    const path =
      issue.field === 'title'
        ? ['title']
        : issue.field === 'measurementLineDescription'
          ? ['content', 'measurementLines', issue.line, 'description']
          : issue.field === 'measurementLineQuantity'
            ? ['content', 'measurementLines', issue.line, 'quantity']
            : ['content', issue.field];
    context.addIssue({ code: 'custom', path, message: issue.code });
  }
  if (
    value.visibility === 'internal_only' &&
    (value.content.requiresCustomerResponse || value.content.requiresSignature)
  ) {
    context.addIssue({ code: 'custom', path: ['visibility'], message: 'customer_visibility_required' });
  }
}

export const saveWorkArtifactSchema = saveWorkArtifactFields.superRefine((value, context) => {
  addFieldRuleIssues(value, context);
  if (value.submit && !value.submitActionId) {
    context.addIssue({ code: 'custom', path: ['submitActionId'], message: 'submit_action_required' });
  }
  if (Boolean(value.correctsRevisionId) !== Boolean(value.correctionReason)) {
    context.addIssue({ code: 'custom', path: ['correctsRevisionId'], message: 'correction_pair_required' });
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'correction_pair_required' });
  }
});

/**
 * A new Arbeitsnachweis draft on a job with its photos, as a phone sends it in
 * the field sync operation `work_artifact.draft`. It follows the draft rules
 * of a save and is never a submit. Each photo is a job document the same
 * person uploaded before, named by its id, with the id of its link.
 */
export const workArtifactDraftSchema = saveWorkArtifactFields
  .pick({
    artifactId: true,
    revisionId: true,
    kind: true,
    visibility: true,
    capturedAt: true,
    title: true,
    content: true,
  })
  .extend({
    /** The person who wrote the draft on the phone; only that person's session sends it. */
    authorId: uuidSchema,
    jobId: uuidSchema,
    photos: z
      .array(z.strictObject({ linkId: uuidSchema, documentId: uuidSchema }))
      .max(WORK_ARTIFACT_DRAFT_PHOTO_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    addFieldRuleIssues({ ...value, submit: false }, context);
    const distinct = (ids: string[]): boolean => new Set(ids).size === ids.length;
    if (
      !distinct(value.photos.map((photo) => photo.linkId)) ||
      !distinct(value.photos.map((photo) => photo.documentId))
    ) {
      context.addIssue({ code: 'custom', path: ['photos'], message: 'photos_not_distinct' });
    }
  });

export type WorkArtifactDraftInput = z.infer<typeof workArtifactDraftSchema>;

export const voidWorkArtifactSchema = z.object({
  artifactId: uuidSchema,
  actionId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(2000),
});

/** The review steps a single action records; a customer decision goes through its own schema below. */
const WORK_ARTIFACT_REVIEW_ACTION_TYPES = [
  'review_requested',
  'review_withdrawn',
  'internal_approved',
  'internal_rejected',
  'correction_requested',
] as const satisfies readonly WorkArtifactReviewActionType[];

export const workArtifactActionSchema = z
  .object({
    artifactId: uuidSchema,
    revisionId: uuidSchema,
    actionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    actionType: z.enum(WORK_ARTIFACT_REVIEW_ACTION_TYPES),
    reason: z.string().trim().min(3).max(2000).optional(),
    comment: artifactText,
  })
  .superRefine((value, context) => {
    const reasonRequired: WorkArtifactActionType[] = ['internal_rejected', 'correction_requested'];
    if (reasonRequired.includes(value.actionType) && !value.reason) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' });
    }
  });

/**
 * The customer's decision on the current revision with the signer and, when
 * the customer signed, the reserved signature upload: one save records both.
 */
export const workArtifactCustomerDecisionSchema = z
  .object({
    artifactId: uuidSchema,
    revisionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    decisionActionId: uuidSchema,
    decision: z.enum(CUSTOMER_DECISION_TYPES),
    reason: z.string().trim().min(3).max(2000).optional(),
    signer: z.object({
      name: z.string().trim().min(2).max(200),
      role: z.string().trim().max(200).optional(),
      relationship: z.string().trim().min(1).max(200),
    }),
    signature: z.object({ actionId: uuidSchema, documentId: uuidSchema }).optional(),
  })
  .superRefine((value, context) => {
    if (customerDecisionNeedsReason(value.decision) && !value.reason) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' });
    }
    if (value.signature?.actionId === value.decisionActionId) {
      context.addIssue({ code: 'custom', path: ['signature'], message: 'distinct_action_ids_required' });
    }
  });

export const workArtifactTargetSchema = z.object({
  targetType: z.enum(['job', 'project']),
  targetId: uuidSchema,
});

const optionalDescription = z.string().trim().max(1000).optional();

export const linkWorkArtifactDocumentSchema = z.object({
  artifactId: uuidSchema,
  revisionId: uuidSchema,
  linkId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  documentId: uuidSchema,
  relation: z.enum(Constants.public.Enums.work_artifact_document_relation),
  description: optionalDescription,
});

export const linkWorkArtifactSourceSchema = z
  .object({
    artifactId: uuidSchema,
    revisionId: uuidSchema,
    linkId: uuidSchema,
    expectedVersion: z.number().int().nonnegative(),
    timeEntryId: optionalUuid,
    timeSegmentId: optionalUuid,
    inventoryMovementId: optionalUuid,
    description: optionalDescription,
  })
  .refine(
    (value) =>
      [value.timeEntryId, value.timeSegmentId, value.inventoryMovementId].filter(Boolean).length === 1,
    { message: 'exactly_one_source_required' },
  );

export const fulfillInstructionEvidenceSchema = z
  .object({
    fulfillmentId: uuidSchema,
    evidenceRequirementId: uuidSchema,
    documentId: optionalUuid,
    artifactRevisionId: optionalUuid,
    note: z.string().trim().max(2000).optional(),
  })
  .refine((value) => Boolean(value.documentId) !== Boolean(value.artifactRevisionId), {
    message: 'exactly_one_evidence_required',
  });

export const removeInstructionEvidenceFulfillmentSchema = z.object({
  fulfillmentId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(2000),
});
