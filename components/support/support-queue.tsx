'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Inbox } from 'lucide-react';

import { ReportStatusBadge } from '@/components/problem-reports/report-status-badge';
import { ListPagination } from '@/components/shared/list-pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { ListRow } from '@/components/ui/list-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColumnsTableHeader } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { PROBLEM_REPORT_STATUS_LABELS } from '@/lib/problem-reports/messages';
import {
  SUPPORT_QUEUE_BUCKET_FILTERS,
  SUPPORT_QUEUE_STATUS_FILTERS,
  type SupportQueueBucketFilter,
  type SupportQueueQuery,
  type SupportQueueStatusFilter,
} from '@/lib/problem-reports/schemas';
import { PROBLEM_REPORT_BUCKET_LABELS } from '@/lib/problem-reports/support-messages';
import type { SupportQueueEntry, SupportQueuePage } from '@/lib/problem-reports/types';
import { rowIntentPrefetch } from '@/lib/ui/row-intent';
import { formatBerlinDateTime } from '@/lib/utils';
import { BucketBadge, NOT_SORTED, ScrubbedText } from './report-labels';
import { SUPPORT_QUEUE_COLUMNS } from './support-queue-columns';

// Support's queue: every organization's reports, oldest first. A row shows
// the scrubbed copy, or the report's scrub state while it has none; the
// original opens only on the report's own page.

const STATUS_FILTER_LABELS: Record<SupportQueueStatusFilter, string> = {
  offen: 'Offen',
  ...PROBLEM_REPORT_STATUS_LABELS,
  alle: 'Alle',
};
const BUCKET_FILTER_LABELS: Record<SupportQueueBucketFilter, string> = {
  alle: 'Alle',
  ohne: NOT_SORTED,
  ...PROBLEM_REPORT_BUCKET_LABELS,
};
const NOT_ASSIGNED = 'Niemand';

export const supportReportHref = (reportId: string): string => `/support/meldungen/${reportId}`;

function reportTitle(entry: SupportQueueEntry): string {
  return `Nr. ${entry.number}`;
}

function QueueCard({ entry }: { entry: SupportQueueEntry }) {
  const router = useRouter();
  const href = supportReportHref(entry.id);
  return (
    <ListRow interactive onClick={() => router.push(href)}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href}
            className="flex max-w-full min-w-0 rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
          >
            {/* A long organization name gives way; the number always shows. */}
            <span className="min-w-0 truncate">{entry.organizationName}</span>
            <span className="shrink-0 whitespace-pre"> · {reportTitle(entry)}</span>
          </Link>
          <ReportStatusBadge status={entry.status} />
          <BucketBadge bucket={entry.bucket} />
        </div>
        <p className="text-sm break-words">
          <ScrubbedText entry={entry} clamp />
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBerlinDateTime(entry.createdAt)} · Zuständig: {entry.assigneeName ?? NOT_ASSIGNED}
          {entry.filedForCaller ? ' · telefonisch aufgenommen' : ''}
        </p>
      </div>
    </ListRow>
  );
}

function QueueRow({ entry }: { entry: SupportQueueEntry }) {
  const router = useRouter();
  const href = supportReportHref(entry.id);
  return (
    <TableRow
      interactive
      onClick={() => router.push(href)}
      {...rowIntentPrefetch(() => router.prefetch(href))}
    >
      <TableCell className="tabular-nums">{formatBerlinDateTime(entry.createdAt)}</TableCell>
      <TableCell className="whitespace-normal break-words">
        <Link
          href={href}
          className="rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => event.stopPropagation()}
        >
          {entry.organizationName} · {reportTitle(entry)}
        </Link>
        {entry.filedForCaller ? (
          <span className="block text-xs text-muted-foreground">telefonisch aufgenommen</span>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-normal break-words">
        <ScrubbedText entry={entry} clamp />
      </TableCell>
      <TableCell>
        <ReportStatusBadge status={entry.status} />
      </TableCell>
      <TableCell>
        <BucketBadge bucket={entry.bucket} />
      </TableCell>
      <TableCell className="whitespace-normal break-words">
        {entry.assigneeName ?? <span className="text-muted-foreground">{NOT_ASSIGNED}</span>}
      </TableCell>
    </TableRow>
  );
}

function QueueFilters({
  query,
  onChange,
}: {
  query: SupportQueueQuery;
  onChange: (changes: { status?: SupportQueueStatusFilter; einordnung?: SupportQueueBucketFilter }) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <Field label="Status" className="w-full sm:w-52">
        <Select
          value={query.status}
          onValueChange={(value) =>
            onChange({ status: SUPPORT_QUEUE_STATUS_FILTERS.find((status) => status === value) ?? 'offen' })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_QUEUE_STATUS_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_FILTER_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Einordnung" className="w-full sm:w-60">
        <Select
          value={query.bucket}
          onValueChange={(value) =>
            onChange({
              einordnung: SUPPORT_QUEUE_BUCKET_FILTERS.find((bucket) => bucket === value) ?? 'alle',
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_QUEUE_BUCKET_FILTERS.map((bucket) => (
              <SelectItem key={bucket} value={bucket}>
                {BUCKET_FILTER_LABELS[bucket]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export function SupportQueue({ page, query }: { page: SupportQueuePage; query: SupportQueueQuery }) {
  const navigation = useListNavigation();
  const filtered = query.status !== 'offen' || query.bucket !== 'alle';
  return (
    <div className="space-y-4">
      <QueueFilters
        query={query}
        onChange={(changes) =>
          navigation.navigate({
            ...(changes.status === undefined
              ? {}
              : { status: changes.status === 'offen' ? null : changes.status }),
            ...(changes.einordnung === undefined
              ? {}
              : { einordnung: changes.einordnung === 'alle' ? null : changes.einordnung }),
            seite: null,
          })
        }
      />
      {page.entries.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Inbox}
            title="Keine Meldungen gefunden"
            description="Zu diesen Filtern gibt es keine Meldung. Wähle einen anderen Status oder eine andere Einordnung."
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Noch keine offenen Meldungen"
            description="Sobald jemand ein Problem meldet, steht es hier, die älteste Meldung zuerst. Für einen Anruf nimmst du die Meldung selbst auf."
          />
        )
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {page.entries.map((entry) => (
              <QueueCard key={entry.id} entry={entry} />
            ))}
          </div>
          <div className="hidden md:block">
            <Table>
              <ColumnsTableHeader columns={SUPPORT_QUEUE_COLUMNS} />
              <TableBody>
                {page.entries.map((entry) => (
                  <QueueRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <ListPagination
        page={query.page}
        total={page.total}
        busy={navigation.busy}
        label="Seiten der Meldungen"
        onPageChange={(next) => navigation.navigate({ seite: next === 1 ? null : next })}
      />
    </div>
  );
}
