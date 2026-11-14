import { z } from '@/lib/zod';

import { uuidSchema } from '@/lib/validation/uuid';
import {
  PROBLEM_REPORT_BUCKETS,
  PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH,
  PROBLEM_REPORT_FILE_KINDS,
  PROBLEM_REPORT_RESPONSE_MAX_LENGTH,
  PROBLEM_REPORT_STATUSES,
} from './types';

// Boundary schemas of the problem-report actions. The captured context has a
// fixed shape and nothing else (werk-flow/werkflow-planning#331): strict
// objects refuse any other field, and a route is a template whose segments
// are route words or `[parameter]` names, so no id, number or name of a
// record can travel in it.

const ROUTE_SEGMENT = /^(?:[a-z]+(?:-[a-z]+)*|\[[a-zA-Z]+\])$/;

/** A route template such as `/auftraege/[jobNumber]`: no segment carries a value. */
function isRouteTemplate(value: string): boolean {
  if (value === '/') return true;
  return (
    value.startsWith('/') &&
    value
      .slice(1)
      .split('/')
      .every((segment) => ROUTE_SEGMENT.test(segment))
  );
}

const routeTemplateSchema = z.string().max(200).refine(isRouteTemplate);
const controlLabelSchema = z.string().trim().min(1).max(80);
const tokenSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_.:+-]+$/);

export const problemReportContextSchema = z.strictObject({
  routeTemplate: routeTemplateSchema,
  recentActions: z
    .array(
      z.strictObject({ routeTemplate: routeTemplateSchema, controlLabel: controlLabelSchema.nullable() }),
    )
    .max(30),
  clientErrors: z
    .array(
      z.strictObject({
        name: tokenSchema,
        code: tokenSchema.nullable(),
        digest: tokenSchema.nullable(),
        routeTemplate: routeTemplateSchema,
      }),
    )
    .max(10),
  appVersion: tokenSchema,
  device: z.strictObject({
    platform: z.enum(['ios', 'android', 'windows', 'macos', 'linux', 'andere']),
    browser: z.enum(['chrome', 'safari', 'firefox', 'edge', 'samsung', 'andere']),
    viewport: z.strictObject({
      width: z.number().int().min(1).max(20_000),
      height: z.number().int().min(1).max(20_000),
    }),
  }),
  offline: z.boolean(),
});
export type ProblemReportContext = z.infer<typeof problemReportContextSchema>;

/**
 * The scrubbed context: the capture, where the scrubber removed the app
 * version or an error's name, code or digest that may name a record.
 */
const scrubbedProblemReportContextSchema = problemReportContextSchema.extend({
  clientErrors: z
    .array(
      z.strictObject({
        name: tokenSchema.nullable(),
        code: tokenSchema.nullable(),
        digest: tokenSchema.nullable(),
        routeTemplate: routeTemplateSchema,
      }),
    )
    .max(10),
  appVersion: tokenSchema.nullable(),
});
export type ScrubbedProblemReportContext = z.infer<typeof scrubbedProblemReportContextSchema>;

/** The whole capture, or null for the empty object of a report filed without one. Any other shape throws. */
function parseStoredCapture<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const capture = schema.safeParse(value);
  if (capture.success) return capture.data;
  z.strictObject({}).parse(value);
  return null;
}

/** A stored context; a part of a capture throws too. */
export function parseStoredProblemReportContext(value: unknown): ProblemReportContext | null {
  return parseStoredCapture(problemReportContextSchema, value);
}

/** A stored scrubbed context, as the scrubber wrote it. */
export function parseScrubbedProblemReportContext(value: unknown): ScrubbedProblemReportContext | null {
  return parseStoredCapture(scrubbedProblemReportContextSchema, value);
}

const descriptionSchema = z.string().trim().min(1).max(PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH);

export const submitProblemReportInputSchema = z.strictObject({
  organizationId: uuidSchema,
  /** Chosen by the device once per report, so a retry after a lost answer saves nothing twice. */
  reportId: uuidSchema,
  description: descriptionSchema,
  context: problemReportContextSchema,
});
export type SubmitProblemReportInput = z.input<typeof submitProblemReportInputSchema>;

const fileFieldsSchema = {
  organizationId: uuidSchema,
  reportId: uuidSchema,
  kind: z.enum(PROBLEM_REPORT_FILE_KINDS),
  fileName: z.string().trim().min(1).max(200),
};

export const createProblemReportFileUploadTicketInputSchema = z.strictObject({
  ...fileFieldsSchema,
  mimeType: z.string().max(100),
  fileSizeBytes: z.number().int(),
});
export type CreateProblemReportFileUploadTicketInput = z.input<
  typeof createProblemReportFileUploadTicketInputSchema
>;

export const finalizeProblemReportFileUploadInputSchema = z.strictObject({
  ...fileFieldsSchema,
  fileId: uuidSchema,
});
export type FinalizeProblemReportFileUploadInput = z.input<typeof finalizeProblemReportFileUploadInputSchema>;

// Support's actions (docs/features/problem-reports.md, "Support"). A triage
// names only the fields it changes; an empty answer clears it. It also names,
// for exactly those fields, the values the page showed when the change began,
// and the database refuses it when a field holds another value by now.

export const SUPPORT_QUEUE_STATUS_FILTERS = ['offen', ...PROBLEM_REPORT_STATUSES, 'alle'] as const;
export type SupportQueueStatusFilter = (typeof SUPPORT_QUEUE_STATUS_FILTERS)[number];
export const SUPPORT_QUEUE_BUCKET_FILTERS = ['alle', 'ohne', ...PROBLEM_REPORT_BUCKETS] as const;
export type SupportQueueBucketFilter = (typeof SUPPORT_QUEUE_BUCKET_FILTERS)[number];

export const supportQueueQuerySchema = z.strictObject({
  status: z.enum(SUPPORT_QUEUE_STATUS_FILTERS),
  bucket: z.enum(SUPPORT_QUEUE_BUCKET_FILTERS),
  page: z.number().int().min(1).max(100_000),
});
export type SupportQueueQuery = z.infer<typeof supportQueueQuerySchema>;

const triageExpectedSchema = z
  .strictObject({
    status: z.enum(PROBLEM_REPORT_STATUSES),
    bucket: z.enum(PROBLEM_REPORT_BUCKETS).nullable(),
    assigneeId: uuidSchema.nullable(),
    response: z.string().max(PROBLEM_REPORT_RESPONSE_MAX_LENGTH).nullable(),
  })
  .partial();

/** Whether two objects name the same keys, whatever their values. */
const sameKeySet = (left: object, right: object): boolean =>
  Object.keys(left).sort().join() === Object.keys(right).sort().join();

export const triageProblemReportInputSchema = z
  .strictObject({
    reportId: uuidSchema,
    changes: z
      .strictObject({
        status: z.enum(PROBLEM_REPORT_STATUSES),
        bucket: z.enum(PROBLEM_REPORT_BUCKETS).nullable(),
        assigneeId: uuidSchema.nullable(),
        response: z
          .string()
          .trim()
          .max(PROBLEM_REPORT_RESPONSE_MAX_LENGTH)
          .transform((text) => text || null)
          .nullable(),
      })
      .partial(),
    /** The values the page showed for the changed fields when the change began. */
    expected: triageExpectedSchema,
  })
  .refine((input) => sameKeySet(input.changes, input.expected));
export type TriageProblemReportInput = z.input<typeof triageProblemReportInputSchema>;

export const openProblemReportAttachmentInputSchema = z.strictObject({
  reportId: uuidSchema,
  fileId: uuidSchema,
});
export type OpenProblemReportAttachmentInput = z.input<typeof openProblemReportAttachmentInputSchema>;

export const fileProblemReportForCallerInputSchema = z.strictObject({
  organizationId: uuidSchema,
  /** The member who phoned: the report's reporter. */
  reporterId: uuidSchema,
  /** Chosen by the support person's device once per report, as for a member's own report. */
  reportId: uuidSchema,
  description: descriptionSchema,
});
export type FileProblemReportForCallerInput = z.input<typeof fileProblemReportForCallerInputSchema>;

// A report thread's write-back (docs/features/problem-reports.md, "Hand-out
// to report threads"): bucket, status and the answer to the reporter, each
// optional, at least one, with the value each change was based on under the
// same keys. The thread never sees support's answer, so it expects no answer
// (null) or the text it wrote itself. It sets no assignee and clears no field.
const writeBackChangesSchema = z
  .strictObject({
    status: z.enum(PROBLEM_REPORT_STATUSES),
    bucket: z.enum(PROBLEM_REPORT_BUCKETS),
    response: z.string().trim().min(1).max(PROBLEM_REPORT_RESPONSE_MAX_LENGTH),
  })
  .partial();

export const problemReportWriteBackSchema = z
  .strictObject({
    changes: writeBackChangesSchema,
    expected: triageExpectedSchema.omit({ assigneeId: true }),
  })
  .refine(({ changes, expected }) => Object.keys(changes).length > 0 && sameKeySet(changes, expected));
export type ProblemReportWriteBack = z.infer<typeof problemReportWriteBackSchema>;
