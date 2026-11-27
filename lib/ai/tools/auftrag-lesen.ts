import 'server-only';

import { type ToolValue, recordText } from '@/lib/ai/context';
import { defineTool } from '@/lib/ai/tools/define-tool';
import { formatSiteAddress } from '@/lib/clients/types';
import { readJobByNumber } from '@/lib/jobs/job-detail-reads';
import { jobDetailHref } from '@/lib/jobs/routes';
import { JOB_PRIORITY_LABELS, JOB_STATUS_LABELS, type JobWithDetails } from '@/lib/jobs/types';
import { formatEmployeeRecordName } from '@/lib/personnel/types';
import { WORK_EXECUTION_LABELS } from '@/lib/work-lifecycle/types';
import { z } from '@/lib/zod';

/**
 * What one call returns at most, so a turn's next step stays under its input
 * cap: no column bounds these texts, and a description may hold 20,000
 * characters. The job page shows the rest.
 */
const LIMITS = { longText: 2_000, shortText: 200, team: 20 } as const;

/** A text cut at `limit` characters, and whether it was cut. */
function bounded(text: string | null, limit: number): { text: string | null; cut: boolean } {
  const characters = Array.from(text ?? '');
  if (characters.length <= limit) return { text, cut: false };
  return { text: characters.slice(0, limit).join(''), cut: true };
}

/** A short field as record text; a cut one ends in „…“. */
function shortText(text: string | null): ToolValue {
  const { text: kept, cut } = bounded(text, LIMITS.shortText);
  return recordText(cut ? `${kept}…` : kept);
}

/** The job as the model reads it, from the page reader's result for the caller's role. */
function jobValue(job: JobWithDetails): ToolValue {
  const { client, site, contact, project } = job;
  const description = bounded(job.description, LIMITS.longText);
  const access = bounded(site?.accessNotes ?? null, LIMITS.longText);
  // A job with several visits is planned on the Plantafel; its own date names only one, so the page shows none.
  const severalVisits = (job.scheduledVisitCount ?? 0) > 1;
  return {
    nummer: shortText(job.jobNumber),
    altnummer: shortText(job.sourceNumber ?? null),
    titel: shortText(job.title),
    beschreibung: recordText(description.text),
    beschreibungGekuerzt: description.cut,
    // The status the job page shows: the work's execution state, else the old status.
    status: job.executionState ? WORK_EXECUTION_LABELS[job.executionState] : JOB_STATUS_LABELS[job.status],
    geparkt: job.status === 'geparkt',
    prioritaet: JOB_PRIORITY_LABELS[job.priority],
    termin: severalVisits ? null : job.plannedDate,
    uhrzeit: severalVisits ? null : job.plannedTime,
    geplanteMinuten: job.plannedWorkingMinutes,
    erledigtAm: job.actualCompletionDate,
    geplanteEinsaetze: job.scheduledVisitCount ?? 0,
    kunde: client
      ? {
          name: shortText(client.name),
          kundennummer: shortText(client.customerNumber),
          adresse: shortText(client.address),
          telefon: shortText(client.phone),
        }
      : null,
    einsatzort: {
      name: shortText(site?.name ?? null),
      adresse: shortText((site && formatSiteAddress(site)) || job.location),
      zugang: recordText(access.text),
      zugangGekuerzt: access.cut,
    },
    ansprechpartner: contact
      ? { name: shortText(contact.name), rolle: shortText(contact.role), telefon: shortText(contact.phone) }
      : null,
    projekt: project ? { nummer: shortText(project.projectNumber), name: shortText(project.name) } : null,
    team: job.assignments.slice(0, LIMITS.team).map((person) => shortText(formatEmployeeRecordName(person))),
    teamGesamt: job.assignments.length,
    // The link holds the editable numbers, so it is record text too; both are at most 100 characters.
    link: recordText(jobDetailHref(job, project)),
  };
}

/**
 * One Auftrag through the reader of `/auftraege/[jobNumber]`: the office reads
 * any job of its organization, an employee only an assigned one, in the field
 * view. The page's billing parties and work leads stay out.
 */
export const auftragLesen = defineTool({
  name: 'auftrag_lesen',
  label: 'Auftrag lesen',
  description:
    'Liest einen Auftrag nach Nummer: Beschreibung, Status, Termin, Kunde, Einsatzort mit Zugang, Ansprechpartner, Projekt, Team und Link. Handwerker lesen nur zugewiesene Aufträge.',
  input: z.strictObject({
    nummer: z.string().trim().min(1).max(100).describe('Auftragsnummer'),
  }),
  roles: ['admin', 'buero', 'employee'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['work', 'customer', 'staff-name'],
  writesMemory: false,
  async execute(input, ctx) {
    const read = await readJobByNumber(ctx, input.nummer, 'auftragLesen');
    if (read.success) return { status: 'ok', value: { auftrag: jobValue(read.job) } };
    if (read.error === 'job_not_found') return { status: 'ok', value: { auftrag: null } };
    return { status: read.error === 'not_authorized' ? 'refused' : 'failed' };
  },
});
