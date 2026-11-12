'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { issueProblemReportFileUploadTicket, registerUploadedProblemReportFile } from './file-upload';
import type { ReportFiler } from './reads';
import {
  createProblemReportFileUploadTicketInputSchema,
  finalizeProblemReportFileUploadInputSchema,
  type CreateProblemReportFileUploadTicketInput,
  type FinalizeProblemReportFileUploadInput,
} from './schemas';
import type { ProblemReportFileUploadTicketResult } from './types';

// A member's upload of the screenshot and attachments of a report they sent
// themselves (lib/problem-reports/file-upload.ts owns the flow). A report
// support filed for a caller takes files only through support's actions.

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;

/** Resolves the caller as a member of the input's organization and runs the step as that filer. */
async function asMember<Input extends { organizationId: string }, Result>(
  input: Input,
  step: (filer: ReportFiler, input: Input) => Promise<Result>,
): Promise<Result | ActionFailure> {
  const auth = await resolveActionContextFor(input.organizationId);
  if (!auth.success) return auth;
  return step({ orgId: auth.context.orgId, userId: auth.context.userId, as: 'reporter' }, input);
}

export async function createProblemReportFileUploadTicket(
  rawInput: CreateProblemReportFileUploadTicketInput,
): Promise<ProblemReportFileUploadTicketResult> {
  const parsed = createProblemReportFileUploadTicketInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  return asMember(parsed.data, issueProblemReportFileUploadTicket);
}

export async function finalizeProblemReportFileUpload(
  rawInput: FinalizeProblemReportFileUploadInput,
): Promise<ActionResult> {
  const parsed = finalizeProblemReportFileUploadInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  return asMember(parsed.data, registerUploadedProblemReportFile);
}
