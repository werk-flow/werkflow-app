import { z } from '@/lib/zod';

import { uuidSchema } from '@/lib/validation/uuid';
import { PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH, PROBLEM_REPORT_FILE_KINDS } from './types';

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

const problemReportContextSchema = z.strictObject({
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
 * A stored context: the whole capture, or null for the empty object of a
 * report filed without one. Any other shape throws, a part of a capture too.
 */
export function parseStoredProblemReportContext(value: unknown): ProblemReportContext | null {
  const capture = problemReportContextSchema.safeParse(value);
  if (capture.success) return capture.data;
  z.strictObject({}).parse(value);
  return null;
}

export const submitProblemReportInputSchema = z.strictObject({
  organizationId: uuidSchema,
  /** Chosen by the device once per report, so a retry after a lost answer saves nothing twice. */
  reportId: uuidSchema,
  description: z.string().trim().min(1).max(PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH),
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
