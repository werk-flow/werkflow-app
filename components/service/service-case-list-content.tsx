'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { SectionError } from '@/components/ui/section-error';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactElement } from 'react';
import { MapPin, Plus, Siren } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { ListPagination } from '@/components/shared/list-pagination';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchInput } from '@/components/ui/search-input';
import { ListRow } from '@/components/ui/list-row';
import { PendingRow } from '@/components/ui/pending-row';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type {
  ServiceCaseListQuery,
  ServiceCasePage,
  ServiceCaseStatusFilter,
} from '@/lib/service-cases/list-page';
import {
  SERVICE_CASE_STATUSES,
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseListItem,
} from '@/lib/service-cases/types';
import {
  ServiceCaseFormDialog,
  type ServiceCaseCreateSubmission,
  type ServiceCasePendingDraft,
} from './service-case-form-dialog';

// The page mounts the create button in its own Suspense tree beside the
// heading, so a submission reaches the list through this module channel
// instead of props. The list is the one listener: it renders the pending
// row, settles through its live read, and shows the failure banner.
const submissionListeners = new Set<(submission: ServiceCaseCreateSubmission) => void>();
function announceSubmission(submission: ServiceCaseCreateSubmission): void {
  for (const listener of submissionListeners) listener(submission);
}

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
const TWO_LINE_CELL = (
  <span className="block space-y-1.5">
    <Skeleton className="h-4 w-40" />
    <Skeleton className="h-3 w-24" />
  </span>
);
export const SERVICE_CASE_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'case', header: 'Servicefall', skeleton: TWO_LINE_CELL },
  { id: 'site', header: 'Kunde & Einsatzort', skeleton: TWO_LINE_CELL },
  { id: 'urgency', header: 'Dringlichkeit', className: 'w-36', skeleton: <Skeleton className="h-4 w-16" /> },
  { id: 'status', header: 'Status', className: 'w-44', skeleton: <Skeleton className="h-6 w-24" /> },
];

function serviceCaseHref(caseNumber: string): string {
  return `/service/faelle/${encodeURIComponent(caseNumber)}`;
}

function ServiceCaseMobileList({
  visiblePending,
  filtered,
}: {
  visiblePending: ServiceCasePendingDraft[];
  filtered: ServiceCaseListItem[];
}): ReactElement {
  return (
    <div className="space-y-2 md:hidden">
      {visiblePending.map((draft) => (
        <ListRow
          key={draft.id}
          role="status"
          aria-label="Wird gespeichert"
          data-pending-row=""
          className="opacity-70"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-medium">
              <InlinePending active />
              <span className="truncate">{draft.summary}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {draft.clientName} · {draft.siteName}
            </span>
          </span>
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">
            {SERVICE_CASE_STATUS_LABELS[draft.status]}
          </span>
        </ListRow>
      ))}
      {filtered.map((item) => (
        <ListRow key={item.id} asChild interactive>
          <Link href={serviceCaseHref(item.caseNumber)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.summary}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {item.caseNumber} · {item.clientName} · {item.siteName}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">
              {SERVICE_CASE_STATUS_LABELS[item.status]}
            </span>
          </Link>
        </ListRow>
      ))}
    </div>
  );
}

function ServiceCaseTable({
  visiblePending,
  filtered,
  router,
}: {
  visiblePending: ServiceCasePendingDraft[];
  filtered: ServiceCaseListItem[];
  router: ReturnType<typeof useRouter>;
}): ReactElement {
  return (
    <div className="hidden rounded-lg border shadow-xs md:block">
      <Table>
        <TableHeader>
          <TableRow>
            {SERVICE_CASE_COLUMNS.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visiblePending.map((draft) => (
            <PendingRow
              key={draft.id}
              columns={SERVICE_CASE_COLUMNS}
              cells={{
                case: (
                  <span>
                    <span className="block font-medium">{draft.summary}</span>
                    <Skeleton className="mt-1 h-3 w-24" />
                  </span>
                ),
                site: (
                  <span>
                    <span className="block">{draft.clientName}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" />
                      {draft.siteName}
                    </span>
                  </span>
                ),
                urgency: SERVICE_CASE_URGENCY_LABELS[draft.urgency],
                status: (
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {SERVICE_CASE_STATUS_LABELS[draft.status]}
                  </span>
                ),
              }}
            />
          ))}
          {filtered.map((item) => {
            const href = serviceCaseHref(item.caseNumber);
            return (
              <TableRow key={item.id} interactive onClick={() => router.push(href)}>
                <TableCell>
                  <Link href={href} className="font-medium" onClick={(event) => event.stopPropagation()}>
                    {item.summary}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {item.caseNumber}
                    {item.equipment.length
                      ? ` · ${item.equipment.length} Anlage${item.equipment.length === 1 ? '' : 'n'}`
                      : ''}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block">{item.clientName}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3 shrink-0" />
                    {item.siteName}
                  </span>
                </TableCell>
                <TableCell>{SERVICE_CASE_URGENCY_LABELS[item.urgency]}</TableCell>
                <TableCell>
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {SERVICE_CASE_STATUS_LABELS[item.status]}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Offene Servicefälle' },
  { value: 'all', label: 'Alle Status' },
  ...SERVICE_CASE_STATUSES.map((value) => ({ value, label: SERVICE_CASE_STATUS_LABELS[value] })),
];

/**
 * The server selects the page: status scope, search and the count apply in
 * the database before the page boundary, and the URL owns that state. The
 * typed search and the chosen status stay ahead of the URL while the read is
 * under way, so both react in the first frame; each committed query remounts
 * the results.
 */
export function ServiceCaseListContent({
  initialPage,
  query,
}: {
  initialPage: ServiceCasePage;
  query: ServiceCaseListQuery;
}): ReactElement {
  const navigation = useListNavigation();
  const [search, setSearch] = useState(query.search);
  const [status, setStatus] = useState<ServiceCaseStatusFilter>(query.status);
  const shownSearch = navigation.busy ? search : query.search;
  const shownStatus = navigation.busy ? status : query.status;

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row">
        <SearchInput
          wrapperClassName="flex-1"
          value={shownSearch}
          onValueChange={(value) => {
            setStatus(shownStatus);
            setSearch(value);
            navigation.navigate({ q: value, page: 1 }, 250);
          }}
          aria-label="Servicefälle durchsuchen"
          placeholder="Nummer, Kunde, Einsatzort oder Anlage suchen…"
        />
        {/* Twelve options: at or above ten the registry requires a searchable control. */}
        <div className="w-full md:w-60">
          <SearchableSelect
            ariaLabel="Servicefälle nach Status filtern"
            value={shownStatus}
            onChange={(value) => {
              setSearch(shownSearch);
              setStatus(value as ServiceCaseStatusFilter);
              navigation.navigate({ status: value === 'open' ? null : value, page: 1 });
            }}
            options={STATUS_OPTIONS}
            searchPlaceholder="Status suchen"
            emptyMessage="Kein passender Status"
          />
        </div>
      </div>
      <ServiceCaseListResults
        key={`${query.search}|${query.status}|${query.page}`}
        initialPage={initialPage}
        query={query}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
    </>
  );
}

/** One committed page: its live read, the pending creations and the page controls. */
function ServiceCaseListResults({
  initialPage,
  query,
  busy,
  onPageChange,
}: {
  initialPage: ServiceCasePage;
  query: ServiceCaseListQuery;
  busy: boolean;
  onPageChange: (page: number) => void;
}): ReactElement {
  const router = useRouter();
  const { activeOrgId } = useOrganization();
  // Reads over GET, outside the Server Action queue, through the reader of the
  // first render; a same-scope event during a read queues one follow-up.
  const live = useLiveView({
    tables: ['service_cases'],
    initialData: initialPage,
    coalesceWhileReading: true,
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'service-case-page',
        { ...query, organizationId: activeOrgId },
        signal,
      );
      return result.success
        ? { ok: true as const, data: result.page }
        : { ok: false as const, error: result.error };
    },
  });
  const page = live.data ?? initialPage;
  const { showBanner } = useBanner();
  const [pendingCreates, setPendingCreates] = useState<ServiceCasePendingDraft[]>([]);
  const liveRefresh = live.refresh;
  const liveInvalidate = live.invalidate;
  useEffect(() => {
    const listener = ({ draft, result }: ServiceCaseCreateSubmission) => {
      liveInvalidate();
      setPendingCreates((current) => [...current, draft]);
      void result
        .then(async (outcome) => {
          if (outcome.success) await liveRefresh();
          else showBanner({ variant: 'error', message: outcome.message });
        })
        .finally(() => setPendingCreates((current) => current.filter((item) => item.id !== draft.id)));
    };
    submissionListeners.add(listener);
    return () => {
      submissionListeners.delete(listener);
    };
  }, [liveInvalidate, liveRefresh, showBanner]);
  // The list is newest first, so a new record leads; a Realtime read that
  // arrives before the settle read drops the placeholder by id.
  const visiblePending = pendingCreates.filter((draft) => !page.cases.some((item) => item.id === draft.id));

  return (
    <>
      {live.isStale && (
        <SectionError onRetry={() => void live.refresh()} retryPending={live.isRefreshing}>
          Die angezeigten Servicefälle konnten nicht aktualisiert werden.
        </SectionError>
      )}
      {page.cases.length === 0 && visiblePending.length === 0 ? (
        page.hasAnyCase ? (
          <EmptyState
            icon={Siren}
            title="Keine Servicefälle gefunden"
            description="Zu Suche und Filter gibt es keinen Servicefall. Ändere die Suche oder den Filter."
          />
        ) : (
          <EmptyState
            icon={Siren}
            title="Noch keine Servicefälle"
            description="Erfasse den ersten Servicefall, sobald eine Störung oder Reparatur gemeldet wird."
          />
        )
      ) : (
        <>
          <ServiceCaseMobileList visiblePending={visiblePending} filtered={page.cases} />
          <ServiceCaseTable visiblePending={visiblePending} filtered={page.cases} router={router} />
        </>
      )}
      <ListPagination
        label="Servicefälle"
        page={query.page}
        total={page.total}
        busy={busy}
        onPageChange={onPageChange}
      />
    </>
  );
}

export function ServiceCaseCreateButton(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Servicefall erfassen
      </Button>
      {open && <ServiceCaseFormDialog open onOpenChange={setOpen} onSubmitted={announceSubmission} />}
    </>
  );
}
