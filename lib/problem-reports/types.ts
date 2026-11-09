import type { ActionResult } from '@/lib/action-result';

// The vocabularies of a problem report, as the database check constraints of
// 20261128090000_store_problem_reports_privately.sql allow them.

export const PROBLEM_REPORT_STATUSES = ['eingegangen', 'in_bearbeitung', 'erledigt', 'abgelehnt'] as const;
export type ProblemReportStatus = (typeof PROBLEM_REPORT_STATUSES)[number];

export const PROBLEM_REPORT_FILE_KINDS = ['screenshot', 'anhang'] as const;
export type ProblemReportFileKind = (typeof PROBLEM_REPORT_FILE_KINDS)[number];

/** The longest description a report keeps, in characters. */
export const PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH = 5000;
/** How many attachments one report keeps beside its screenshot. */
export const PROBLEM_REPORT_MAX_ATTACHMENTS = 5;

/** The types and the size limit each file kind accepts. */
export const PROBLEM_REPORT_FILE_RULES: Record<
  ProblemReportFileKind,
  { mimeTypes: readonly string[]; maxSizeBytes: number }
> = {
  screenshot: { mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], maxSizeBytes: 5 * 1024 * 1024 },
  anhang: {
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'],
    maxSizeBytes: 15 * 1024 * 1024,
  },
};

/** One of the caller's own reports, as the reporter reads it. */
export type OwnProblemReport = {
  id: string;
  createdAt: string;
  status: ProblemReportStatus;
  closedAt: string | null;
  response: string | null;
  /** Null once the deletion period removed the original. */
  description: string | null;
};

export type SubmitProblemReportResult = ActionResult<{ reportId: string }>;
export type ProblemReportFileUploadTicketResult = ActionResult<{
  ticket: { fileId: string; uploadUrl: string };
}>;
export type OwnProblemReportsResult = ActionResult<{ reports: OwnProblemReport[] }>;
export type OwnProblemReportResult = ActionResult<{ report: OwnProblemReport }>;
