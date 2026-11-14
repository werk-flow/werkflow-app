import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';
import type { WorkExecutionState } from '@/lib/work-lifecycle/types';

/** The work a „Projektleitung“ is named on: a project or a standalone job. */
export const workLeadTargetSchema = z.object({
  targetType: z.enum(['project', 'job']),
  targetId: uuidSchema,
});
export type WorkLeadTarget = z.infer<typeof workLeadTargetSchema>;

/** Ends the open holding the caller saw. */
export const endWorkLeadSchema = workLeadTargetSchema.extend({ expectedLeadId: uuidSchema });

/** Names a member; `expectedLeadId` is the open holding the caller saw, null for none. */
export const nameWorkLeadSchema = workLeadTargetSchema.extend({
  userId: uuidSchema,
  expectedLeadId: uuidSchema.nullable(),
});

/** A lead holding as the server reads it, before the names are resolved. */
export type WorkLeadHoldingRow = {
  id: string;
  employee_record_id: string;
  started_at: string;
  started_by: string | null;
  ended_at: string | null;
  ended_by: string | null;
};

/**
 * A standalone job's own lead holdings as the job read embeds them, so the
 * office's job page needs no read of its own. The read orders them newest first.
 */
export const JOB_WORK_LEADS_EMBED =
  'work_leads!work_leads_job_fk(id, employee_record_id, started_at, started_by, ended_at, ended_by)';

/** One lead holding as the office sees it in the history. */
export type WorkLeadHolding = {
  id: string;
  userId: string | null;
  name: string;
  startedAt: string;
  startedByName: string | null;
  endedAt: string | null;
  endedByName: string | null;
};

/** The lead of one piece of work: its open holding and every holding, newest first. */
export type WorkLeadPanel = {
  current: WorkLeadHolding | null;
  history: WorkLeadHolding[];
};

/** The sentences of the codes this area owns; the shared codes come from lib/action-messages.ts. */
export const WORK_LEAD_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  work_lead_member_not_eligible:
    'Diese Person kann keine Projektleitung übernehmen: Sie gehört nicht mehr zum Betrieb oder hat keinen Zugang.',
  work_lead_changed:
    'Die Projektleitung wurde gerade von jemand anderem geändert. Prüfe sie und versuche es erneut.',
  work_lead_target_not_found: 'Diese Arbeit gibt es nicht mehr.',
  work_lead_unconfirmed:
    'Die Antwort kam nicht an. Prüfe die Projektleitung nach dem Neuladen, bevor du es erneut versuchst.',
};

/**
 * What a „Projektleitung“ reads of a job: its scope, instructions and
 * evidence. Allow-listed like the field work pack: no price, cost, billable
 * flag, recipient, customer record or another worker's time has a field here.
 */
export type LedInstruction = {
  id: string;
  content: string;
  required: boolean;
  completed: boolean;
};

export type LedJob = {
  id: string;
  jobNumber: string | null;
  title: string;
  requestedOutcome: string | null;
  executionState: WorkExecutionState | null;
  plannedDate: string | null;
  instructions: LedInstruction[];
  artifacts: WorkArtifactSummary[];
};

export type LedProjectOverview = {
  projectId: string;
  projectNumber: string | null;
  name: string;
  /** The project's own Arbeitsnachweise. */
  projectArtifacts: WorkArtifactSummary[];
  jobs: LedJob[];
};
