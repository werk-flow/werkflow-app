import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { LIST_PAGE_SIZE, parseListPage } from '@/lib/ui/list-pagination';
import type { SortColumn, UnifiedListEntry } from './types';
import { resolveAuftraegeSortColumn, type AuftraegeColumnId } from './auftraege-table-columns';

export const JOB_LIST_SECTIONS = ['active', 'parked', 'archived'] as const;
export type JobListSection = typeof JOB_LIST_SECTIONS[number];
export type ListSearchParams = Record<string, string | string[] | undefined>;
export type JobListQuery = {
  page: number;
  pageSize: typeof LIST_PAGE_SIZE;
  search: string;
  sort: SortColumn;
  direction: 'asc' | 'desc';
  entryType: 'alle' | 'jobs' | 'projekte';
  status: 'alle' | 'not_started' | 'in_progress' | 'interrupted';
  clientIds: string[];
  employeeIds: string[];
  dateFrom: string;
  dateTo: string;
  enabled: boolean;
};
const single = (value: string | string[] | undefined): string => typeof value === 'string' ? value : '';
const ids = (value: string | string[] | undefined): string[] => single(value).split(',').filter((id) => uuidSchema.safeParse(id).success);

export function parseJobListQuery(params: ListSearchParams, section: JobListSection, visibleColumns?: AuftraegeColumnId[]): JobListQuery {
  const read = (key: string): string => single(params[`${section}_${key}`]);
  const sort = z.enum(['nr', 'bezeichnung', 'kunde', 'status', 'prioritaet', 'datum']).catch('datum').parse(read('sort'));
  const direction = z.enum(['asc', 'desc']).catch('desc').parse(read('direction'));
  const entryType = z.enum(['alle', 'jobs', 'projekte']).catch('alle').parse(read('type'));
  const status = z.enum(['alle', 'not_started', 'in_progress', 'interrupted']).catch('alle').parse(read('status'));
  const date = (key: string): string => z.iso.date().safeParse(read(key)).success ? read(key) : '';
  return {
    page: parseListPage(read('page')), pageSize: LIST_PAGE_SIZE,
    search: read('q').trim().slice(0, 250), sort: visibleColumns ? resolveAuftraegeSortColumn(sort, visibleColumns) : sort, direction, entryType, status,
    clientIds: ids(params[`${section}_clients`]), employeeIds: ids(params[`${section}_employees`]),
    dateFrom: date('from'), dateTo: date('to'), enabled: section !== 'archived' || read('open') === '1',
  };
}

const counts = {
  jobCount: z.number().int().nonnegative(), completedJobCount: z.number().int().nonnegative(),
  inProgressJobCount: z.number().int().nonnegative(), parkedJobCount: z.number().int().nonnegative(),
};
const jobEntryPageSchema = z.object({
  entries: z.array(z.object({ id: uuidSchema, type: z.enum(['standalone-job', 'project']), ...counts, assignedUserIds: z.array(uuidSchema) })),
  total: z.number().int().nonnegative(), sectionTotal: z.number().int().nonnegative(),
  statusCounts: z.object({ alle: z.number(), not_started: z.number(), in_progress: z.number(), interrupted: z.number() }),
});
export const jobListPagesSchema = z.object({ active: jobEntryPageSchema, parked: jobEntryPageSchema, archived: jobEntryPageSchema });
export type JobListPages = z.infer<typeof jobListPagesSchema>;
export type JobListQueries = Record<JobListSection, JobListQuery>;
export type JobListPagination = { queries: JobListQueries; pages: JobListPages };

export const entityIdPageSchema = z.object({ ids: z.array(uuidSchema), total: z.number().int().nonnegative() });

export function retainPageEntries(entries: UnifiedListEntry[], selectedIds: string[], initialIds: Set<string>, pendingIds: Set<string>): UnifiedListEntry[] {
  const positions = new Map(selectedIds.map((id, index) => [id, index]));
  const idOf = (entry: UnifiedListEntry): string => entry.type === 'project' ? entry.project.id : entry.job.id;
  return entries.filter((entry) => positions.has(idOf(entry)) || !initialIds.has(idOf(entry)) || pendingIds.has(idOf(entry)))
    .sort((first, second) => (positions.get(idOf(first)) ?? -1) - (positions.get(idOf(second)) ?? -1));
}
