'use server';

import { after } from 'next/server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { loggedRead } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import {
  otherSupportUserIds,
  supportCallerOf,
  supportUserIds,
  type SupportCallerResult,
} from '@/lib/support/allowlist';
import { uuidSchema } from '@/lib/validation/uuid';
import { issueProblemReportFileUploadTicket, registerUploadedProblemReportFile } from './file-upload';
import type { ReportFiler } from './reads';
import { scrubStoredProblemReport } from './scrub/scrub-report';
import {
  createProblemReportFileUploadTicketInputSchema,
  fileProblemReportForCallerInputSchema,
  finalizeProblemReportFileUploadInputSchema,
  openProblemReportAttachmentInputSchema,
  supportQueueQuerySchema,
  triageProblemReportInputSchema,
  type CreateProblemReportFileUploadTicketInput,
  type FileProblemReportForCallerInput,
  type FinalizeProblemReportFileUploadInput,
  type OpenProblemReportAttachmentInput,
  type SupportQueueQuery,
  type TriageProblemReportInput,
} from './schemas';
import {
  openProblemReportOriginalAs,
  readSupportFilingOptions,
  readSupportQueuePage,
  readSupportReport,
  signProblemReportAttachmentAs,
} from './support-reads';
import type {
  ProblemReportFileUploadTicketResult,
  ProblemReportOriginalResult,
  SubmitProblemReportResult,
  SupportFilingOptionsResult,
  SupportQueueResult,
  SupportReportResult,
} from './types';

// WerkFlow support's work on problem reports, across every organization
// (docs/features/problem-reports.md, "Support"). Support is no organization
// role, so no action here resolves an organization context: each one admits
// the verified session user only when the environment's allowlist names them
// (lib/support/allowlist.ts). An `admin`, a `buero` and an `employee` of a
// customer organization are refused, and so is everyone while the allowlist
// cannot be resolved. An identity check that cannot complete throws.

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;
const triageRefusal = writeRefusalFor(new Set(['report_not_found', 'invalid_triage']));
const filingRefusal = writeRefusalFor(new Set(['reporter_not_member', 'report_conflict']));

/** The guard of every action in this module: the verified session user, admitted as support. */
async function supportCaller(): Promise<SupportCallerResult | ActionFailure<'not_authenticated'>> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  return supportCallerOf(user.id);
}

type TriageChanges = ReturnType<typeof triageProblemReportInputSchema.parse>['changes'];

/** The arguments of a triage of one loaded report, with only the fields the input names. */
function triageArguments(
  report: { id: string; organization_id: string },
  actorId: string,
  changes: TriageChanges,
) {
  return rpcArgs('triage_problem_report', {
    p_organization_id: report.organization_id,
    p_report_id: report.id,
    p_actor_id: actorId,
    p_changes: {
      ...(changes.status === undefined ? {} : { status: changes.status }),
      ...(changes.bucket === undefined ? {} : { bucket: changes.bucket }),
      ...(changes.assigneeId === undefined ? {} : { assignee_id: changes.assigneeId }),
      ...(changes.response === undefined ? {} : { response: changes.response }),
    },
    p_support_ids: otherSupportUserIds(actorId),
  });
}

/** The arguments of a report filed for a caller: the organization is the one support named for the member. */
function filingArguments(
  input: { reportId: string; organizationId: string; reporterId: string; description: string },
  actorId: string,
) {
  return rpcArgs('file_problem_report_for_caller', {
    p_report_id: input.reportId,
    p_organization_id: input.organizationId,
    p_reporter_id: input.reporterId,
    p_actor_id: actorId,
    p_description: input.description,
    p_support_ids: otherSupportUserIds(actorId),
  });
}

/** One page of the queue: every organization's reports, oldest first. */
export async function listSupportProblemReports(rawQuery: SupportQueueQuery): Promise<SupportQueueResult> {
  const query = supportQueueQuerySchema.safeParse(rawQuery);
  if (!query.success) return INVALID_INPUT;
  const support = await supportCaller();
  if (!support.success) return support;
  return readSupportQueuePage(createSupabaseAdminClient(), query.data);
}

/** One report with its scrubbed copy, its redrawn screenshot and its history; no original. */
export async function readSupportProblemReport(reportId: string): Promise<SupportReportResult> {
  const id = uuidSchema.safeParse(reportId);
  if (!id.success) return INVALID_INPUT;
  const support = await supportCaller();
  if (!support.success) return support;
  return readSupportReport(createSupabaseAdminClient(), id.data);
}

/**
 * Sets the fields of one report that the input names: status, bucket,
 * assignee and the answer to the reporter. An assignee is a support person
 * of the allowlist. Each changed field enters the history with the caller.
 */
export async function triageProblemReport(rawInput: TriageProblemReportInput): Promise<ActionResult> {
  const parsed = triageProblemReportInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const { reportId, changes } = parsed.data;
  const support = await supportCaller();
  if (!support.success) return support;
  if (changes.assigneeId && !supportUserIds()?.has(changes.assigneeId.toLowerCase()))
    return { success: false, error: 'assignee_not_support' };

  const admin = createSupabaseAdminClient();
  const { data: report, error: readError } = await loggedRead(
    'triageProblemReport: report read failed',
    admin
      // tenant-scope: cross-organization-by-design — WerkFlow support triages a report of any organization
      .from('problem_reports')
      .select('id, organization_id')
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (readError) return { success: false, error: 'load_failed' };
  if (!report) return { success: false, error: 'report_not_found' };

  const { error } = await admin.rpc(
    'triage_problem_report',
    // tenant-scope: cross-organization-by-design — support triages a report of any organization; the loaded report's own organization scopes the call
    triageArguments(report, support.userId, changes),
  );
  if (error) return triageRefusal(error, 'triage_failed', 'triageProblemReport: save failed');
  return { success: true };
}

/**
 * The original description, the reporter and the attachment list of one
 * report. The opening enters the report's history before the original
 * leaves the server; `original` is null once its deletion period removed it.
 */
export async function openProblemReportOriginal(reportId: string): Promise<ProblemReportOriginalResult> {
  const id = uuidSchema.safeParse(reportId);
  if (!id.success) return INVALID_INPUT;
  const support = await supportCaller();
  if (!support.success) return support;
  return openProblemReportOriginalAs(createSupabaseAdminClient(), support.userId, id.data);
}

/** A short-lived download address of one attachment; the opening enters the history first. */
export async function openProblemReportAttachment(
  rawInput: OpenProblemReportAttachmentInput,
): Promise<ActionResult<{ url: string }>> {
  const parsed = openProblemReportAttachmentInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const support = await supportCaller();
  if (!support.success) return support;
  return signProblemReportAttachmentAs(createSupabaseAdminClient(), support.userId, parsed.data);
}

/** Every organization, and the members of the chosen one, for a report filed for a caller. */
export async function listSupportFilingOptions(
  organizationId: string | null,
): Promise<SupportFilingOptionsResult> {
  const id = uuidSchema.nullable().safeParse(organizationId);
  if (!id.success) return INVALID_INPUT;
  const support = await supportCaller();
  if (!support.success) return support;
  return readSupportFilingOptions(createSupabaseAdminClient(), id.data);
}

/**
 * Files a report for a member who phoned: the member is the reporter, the
 * caller the filer. The database refuses a person who is no member of the
 * organization. The report saves once under the id the device chose; its
 * scrubbed copy is written after the answer.
 */
export async function fileProblemReportForCaller(
  rawInput: FileProblemReportForCallerInput,
): Promise<SubmitProblemReportResult> {
  const parsed = fileProblemReportForCallerInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const support = await supportCaller();
  if (!support.success) return support;

  const { data, error } = await createSupabaseAdminClient().rpc(
    'file_problem_report_for_caller',
    // tenant-scope: cross-organization-by-design — support names the caller's organization; the function refuses a reporter who is no member of it
    filingArguments(input, support.userId),
  );
  if (error) return filingRefusal(error, 'submit_failed', 'fileProblemReportForCaller: save failed');
  // The scrubbed copy follows the answer, as for a member's report: a failed
  // scrub leaves the saved report as it is, and the daily run scrubs it later.
  after(() => scrubStoredProblemReport(input.organizationId, input.reportId));
  return { success: true, reportId: input.reportId, number: data };
}

/**
 * Runs the step as the support person who filed the report. Support adds
 * attachments only: a screenshot is one the reporter's device redrew. The
 * organization is the client's claim: the flow reaches only a report the
 * caller filed in exactly that organization, and answers `report_not_found`
 * for every other.
 */
async function asSupportFiler<Input extends { organizationId: string; kind: string }, Result>(
  input: Input,
  step: (filer: ReportFiler, input: Input) => Promise<Result>,
): Promise<Result | ActionFailure> {
  if (input.kind !== 'anhang') return INVALID_INPUT;
  const support = await supportCaller();
  if (!support.success) return support;
  return step({ orgId: input.organizationId, userId: support.userId, as: 'support' }, input);
}

/** Signs the upload of one attachment of a report the caller filed for a member. */
export async function createSupportReportFileUploadTicket(
  rawInput: CreateProblemReportFileUploadTicketInput,
): Promise<ProblemReportFileUploadTicketResult> {
  const parsed = createProblemReportFileUploadTicketInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  return asSupportFiler(parsed.data, issueProblemReportFileUploadTicket);
}

/** Checks and registers one uploaded attachment of a report the caller filed for a member. */
export async function finalizeSupportReportFileUpload(
  rawInput: FinalizeProblemReportFileUploadInput,
): Promise<ActionResult> {
  const parsed = finalizeProblemReportFileUploadInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  return asSupportFiler(parsed.data, registerUploadedProblemReportFile);
}
