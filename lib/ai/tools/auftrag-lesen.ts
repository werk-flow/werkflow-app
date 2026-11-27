import 'server-only';

import { recordText } from '@/lib/ai/context';
import { defineTool } from '@/lib/ai/tools/define-tool';
import { formatSiteAddress } from '@/lib/clients/types';
import { readJobByNumber } from '@/lib/jobs/job-detail-reads';
import { jobDetailHref } from '@/lib/jobs/routes';
import { JOB_PRIORITY_LABELS } from '@/lib/jobs/types';
import { UNIFIED_STATUS_LABELS, getEntryUnifiedStatus } from '@/lib/jobs/unified-list';
import { formatEmployeeRecordName } from '@/lib/personnel/types';
import { z } from '@/lib/zod';

/**
 * Characters of one long text a call returns. A job description may hold
 * 20,000, and a turn's next step must stay under its input cap; the job page
 * shows the rest.
 */
const TEXT_LIMIT = 2_000;

/** A long text cut at `TEXT_LIMIT` characters, and whether it was cut. */
function boundedText(text: string | null): { text: string | null; cut: boolean } {
  const characters = Array.from(text ?? '');
  if (characters.length <= TEXT_LIMIT) return { text, cut: false };
  return { text: characters.slice(0, TEXT_LIMIT).join(''), cut: true };
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
    if (!read.success) {
      if (read.error === 'job_not_found') return { status: 'ok', value: { auftrag: null } };
      return { status: read.error === 'not_authorized' ? 'refused' : 'failed' };
    }
    // The field view already emptied what an employee may not read: customer number, address, emails, notes.
    const { job } = read;
    const { client, site, contact, project } = job;
    const description = boundedText(job.description);
    const access = boundedText(site?.accessNotes ?? null);
    // A job with several visits is planned on the Plantafel; its own date names only one, so the page shows none.
    const severalVisits = (job.scheduledVisitCount ?? 0) > 1;
    return {
      status: 'ok',
      value: {
        auftrag: {
          nummer: recordText(job.jobNumber),
          altnummer: recordText(job.sourceNumber ?? null),
          titel: recordText(job.title),
          beschreibung: recordText(description.text),
          beschreibungGekuerzt: description.cut,
          status: UNIFIED_STATUS_LABELS[getEntryUnifiedStatus({ type: 'standalone-job', job })],
          prioritaet: JOB_PRIORITY_LABELS[job.priority],
          termin: severalVisits ? null : job.plannedDate,
          uhrzeit: severalVisits ? null : job.plannedTime,
          geplanteMinuten: job.plannedWorkingMinutes,
          erledigtAm: job.actualCompletionDate,
          geplanteEinsaetze: job.scheduledVisitCount ?? 0,
          kunde: client
            ? {
                name: recordText(client.name),
                kundennummer: recordText(client.customerNumber),
                adresse: recordText(client.address),
                telefon: recordText(client.phone),
              }
            : null,
          einsatzort: {
            name: recordText(site?.name ?? null),
            adresse: recordText((site && formatSiteAddress(site)) || job.location),
            zugang: recordText(access.text),
            zugangGekuerzt: access.cut,
          },
          ansprechpartner: contact
            ? {
                name: recordText(contact.name),
                rolle: recordText(contact.role),
                telefon: recordText(contact.phone),
              }
            : null,
          projekt: project
            ? { nummer: recordText(project.projectNumber), name: recordText(project.name) }
            : null,
          team: job.assignments.map((person) => recordText(formatEmployeeRecordName(person))),
          // The link holds the editable numbers, so it is record text too.
          link: recordText(jobDetailHref(job, project)),
        },
      },
    };
  },
});
