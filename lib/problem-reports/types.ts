import type { ActionResult } from '@/lib/action-result';
import type { ProblemReportContext, ScrubbedProblemReportContext } from './schemas';

// The vocabularies of a problem report, as the database check constraints of
// 20261128090002_store_problem_reports_privately.sql allow them.

export const PROBLEM_REPORT_STATUSES = ['eingegangen', 'in_bearbeitung', 'erledigt', 'abgelehnt'] as const;
export type ProblemReportStatus = (typeof PROBLEM_REPORT_STATUSES)[number];

export const PROBLEM_REPORT_BUCKETS = ['blocker', 'fehler', 'unklarheit', 'wunsch'] as const;
export type ProblemReportBucket = (typeof PROBLEM_REPORT_BUCKETS)[number];

export const PROBLEM_REPORT_SCRUB_STATES = ['ausstehend', 'bereinigt', 'nicht_bereinigbar'] as const;
export type ProblemReportScrubState = (typeof PROBLEM_REPORT_SCRUB_STATES)[number];

/** The longest answer support writes to the reporter, in characters. */
export const PROBLEM_REPORT_RESPONSE_MAX_LENGTH = 4000;

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
  /** The organization's own number of the report, which the receipt names. */
  number: number;
  createdAt: string;
  status: ProblemReportStatus;
  closedAt: string | null;
  response: string | null;
  /** A report thread wrote the answer, not a support person. */
  responseByAgent: boolean;
  /** Null once the deletion period removed the original. */
  description: string | null;
};

export type SubmitProblemReportResult = ActionResult<{ reportId: string; number: number }>;
export type ProblemReportFileUploadTicketResult = ActionResult<{
  ticket: { fileId: string; uploadUrl: string };
}>;
export type OwnProblemReportsResult = ActionResult<{ reports: OwnProblemReport[] }>;

/** A support person a report can be assigned to. */
export type SupportAssignee = { userId: string; name: string };

/** One report in support's queue: the scrubbed copy only, never an original. */
export type SupportQueueEntry = {
  id: string;
  number: number;
  organizationName: string;
  createdAt: string;
  status: ProblemReportStatus;
  bucket: ProblemReportBucket | null;
  assigneeName: string | null;
  scrubState: ProblemReportScrubState;
  /** Null until the scrubber wrote the copy. */
  scrubbedDescription: string | null;
  /** The originals are gone after their deletion period; without a scrubbed copy no text is left. */
  originalsDeleted: boolean;
  /** Support filed it for a member who phoned. */
  filedForCaller: boolean;
};

export type SupportQueuePage = {
  entries: SupportQueueEntry[];
  /** Reports that match the filters, before the page boundary. */
  total: number;
};

/** One entry of a report's history, as support reads it. */
export type SupportReportHistoryEntry = {
  id: string;
  createdAt: string;
  /** „Agent“ for a report thread, which acts without an account. */
  actorName: string;
  change:
    | { kind: 'status'; to: ProblemReportStatus | null }
    | { kind: 'bucket'; to: ProblemReportBucket | null }
    | { kind: 'assignee'; toName: string | null }
    | { kind: 'response' }
    | { kind: 'original_opened'; attachment: boolean }
    | { kind: 'handed_out'; part: 'copy' | 'screenshot' };
};

/** One report as support works on it. It holds no original text and no attachment. */
export type SupportReport = SupportQueueEntry & {
  assigneeId: string | null;
  response: string | null;
  /** A report thread wrote the answer, not a support person. */
  responseByAgent: boolean;
  /** The scrubbed context beside the scrubbed copy; null for a report taken by phone and while there is no copy. */
  scrubbedContext: ScrubbedProblemReportContext | null;
  /** A short-lived address of the redrawn screenshot, when the report has one. */
  screenshotUrl: string | null;
  attachmentCount: number;
  assignees: SupportAssignee[];
  history: SupportReportHistoryEntry[];
};

/** A report's originals, which support opens on purpose; each opening is in the history. */
export type ProblemReportOriginal = {
  description: string;
  reporterName: string;
  /** The captured context as the device sent it; null for a report filed for a caller. */
  context: ProblemReportContext | null;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
};

/** The choices of a report support files for a caller. */
export type SupportFilingOptions = {
  organizations: { id: string; name: string }[];
  /** The members of the chosen organization; empty while none is chosen. */
  members: { userId: string; name: string }[];
};

export type SupportQueueResult = ActionResult<{ page: SupportQueuePage }>;
export type SupportReportResult = ActionResult<{ report: SupportReport }>;
export type ProblemReportOriginalResult = ActionResult<{ original: ProblemReportOriginal | null }>;
export type SupportFilingOptionsResult = ActionResult<{ options: SupportFilingOptions }>;
