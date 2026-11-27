import 'server-only';

import { type ToolValue, untrustedText } from '@/lib/ai/context';
import { defineTool } from '@/lib/ai/tools/define-tool';
import type { JobListQuery, JobListSection } from '@/lib/jobs/list-page';
import { readJobListPage } from '@/lib/jobs/list-server';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import { UNIFIED_STATUS_LABELS, getEntryUnifiedStatus } from '@/lib/jobs/unified-list';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

/** The entries one call returns: enough to answer, few enough to keep the context small. */
const RESULT_LIMIT = 10;

const SECTIONS: Readonly<Record<'offen' | 'geparkt' | 'abgeschlossen', JobListSection>> = {
  offen: 'active',
  geparkt: 'parked',
  abgeschlossen: 'archived',
};

const record = (text: string | null) => (text ? untrustedText('record_text', text) : null);

/**
 * Aufträge and Projekte through the reader of `/auftraege`: an employee finds
 * only assigned work, the office all of it.
 */
export const auftraegeFinden = defineTool({
  name: 'auftraege_finden',
  label: 'Aufträge finden',
  description:
    'Findet Aufträge und Projekte nach Nummer, Titel oder Kunde. Gibt höchstens 10 Treffer mit Nummer, Titel, Status, Kunde, Termin und Link zurück. Handwerker sehen nur ihre zugewiesenen Aufträge.',
  input: z.strictObject({
    suche: z.string().trim().max(100).default('').describe('Nummer, Titel oder Kundenname; leer für alle'),
    bereich: z.enum(['offen', 'geparkt', 'abgeschlossen']).default('offen'),
    kundeId: uuidSchema.optional().describe('Nur Aufträge dieses Kunden, aus kunden_finden'),
  }),
  roles: ['admin', 'buero', 'employee'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['work', 'customer'],
  writesMemory: false,
  async execute(input, ctx) {
    const asked = SECTIONS[input.bereich];
    const query = (section: JobListSection): JobListQuery => ({
      page: 1,
      pageSize: RESULT_LIMIT,
      search: input.suche,
      sort: 'datum',
      direction: 'desc',
      entryType: 'alle',
      status: 'alle',
      clientIds: input.kundeId ? [input.kundeId] : [],
      employeeIds: [],
      dateFrom: '',
      dateTo: '',
      enabled: section === asked,
    });
    const page = await readJobListPage(ctx, {
      active: query('active'),
      parked: query('parked'),
      archived: query('archived'),
    });
    if (page === 'load_failed') return { status: 'failed' };
    const jobs = new Map(page.jobs.map((job) => [job.id, job]));
    const projects = new Map(page.projects.map((project) => [project.id, project]));
    const customer = (clientId: string | null) =>
      record(clientId ? (page.clientMap[clientId] ?? null) : null);
    const section = page.pagination.pages[asked];
    const auftraege = section.entries.flatMap((entry): ToolValue[] => {
      const project = entry.type === 'project' ? projects.get(entry.id) : undefined;
      if (project) {
        return [
          {
            art: 'Projekt',
            nummer: record(project.projectNumber),
            titel: record(project.name),
            status: UNIFIED_STATUS_LABELS[getEntryUnifiedStatus({ type: 'project', project, childJobs: [] })],
            auftraege: entry.jobCount,
            kunde: customer(project.clientId),
            beginn: project.plannedStartDate,
            ende: project.plannedEndDate,
            link: projectDetailHref(project),
          },
        ];
      }
      const job = jobs.get(entry.id);
      if (!job) return [];
      return [
        {
          art: 'Auftrag',
          nummer: record(job.jobNumber),
          titel: record(job.title),
          status: UNIFIED_STATUS_LABELS[getEntryUnifiedStatus({ type: 'standalone-job', job })],
          kunde: customer(job.clientId),
          termin: job.plannedDate,
          link: jobDetailHref(job),
        },
      ];
    });
    return { status: 'ok', value: { auftraege, gesamt: section.total } };
  },
});
