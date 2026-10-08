'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { SectionError } from '@/components/ui/section-error';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactElement } from 'react';
import { MapPin, Plus, Wrench } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { ListPagination } from '@/components/shared/list-pagination';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchInput } from '@/components/ui/search-input';
import { ListRow } from '@/components/ui/list-row';
import { PendingRow } from '@/components/ui/pending-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UsableContent } from '@/components/shared/usable-content';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type { EquipmentListQuery, EquipmentPage } from '@/lib/installed-equipment/list-page';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATE_LABELS,
  type EquipmentCategory,
  type EquipmentListItem,
} from '@/lib/installed-equipment/types';
import {
  EquipmentFormDialog,
  type EquipmentCreateSubmission,
  type EquipmentPendingDraft,
} from './equipment-form-dialog';

// The page mounts the create button in its own Suspense tree beside the
// heading, so a submission reaches the list through this module channel
// instead of props. The list is the one listener: it renders the pending
// row, settles through its live read, and shows the failure banner.
const submissionListeners = new Set<(submission: EquipmentCreateSubmission) => void>();
function announceSubmission(submission: EquipmentCreateSubmission): void {
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
export const EQUIPMENT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'equipment', header: 'Anlage', skeleton: TWO_LINE_CELL },
  { id: 'site', header: 'Kunde & Einsatzort', skeleton: TWO_LINE_CELL },
  {
    id: 'manufacturer',
    header: 'Hersteller',
    skeleton: <Skeleton className="h-4 w-32" />,
  },
  {
    id: 'state',
    header: 'Zustand',
    className: 'w-40',
    skeleton: <Skeleton className="h-6 w-24" />,
  },
];

function equipmentHref(equipmentNumber: string): string {
  return `/service/anlagen/${encodeURIComponent(equipmentNumber)}`;
}

function stateLabel(item: EquipmentListItem): string {
  return item.archivedAt ? 'Archiviert' : EQUIPMENT_STATE_LABELS[item.state];
}

type EquipmentListFilters = Pick<EquipmentListQuery, 'search' | 'category' | 'includeArchived'>;

type EquipmentListFiltersProps = {
  filters: EquipmentListFilters;
  onChange: (changes: Partial<EquipmentListFilters>) => void;
};

function EquipmentListFilterBar({ filters, onChange }: EquipmentListFiltersProps): ReactElement {
  const { search, category, includeArchived } = filters;
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <SearchInput
        wrapperClassName="flex-1"
        value={search}
        onValueChange={(value) => onChange({ search: value })}
        aria-label="Anlagen durchsuchen"
        placeholder="Nummer, Name, Hersteller, Modell, Kunde oder Kennung suchen…"
      />
      <Select
        value={category}
        onValueChange={(value) => onChange({ category: value as EquipmentCategory | 'all' })}
      >
        <SelectTrigger className="w-full md:w-64" aria-label="Anlagen nach Kategorie filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle Kategorien</SelectItem>
          {EQUIPMENT_CATEGORIES.map((value) => (
            <SelectItem key={value} value={value}>
              {EQUIPMENT_CATEGORY_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant={includeArchived ? 'secondary' : 'outline'}
        onClick={() => onChange({ includeArchived: !includeArchived })}
      >
        Archivierte {includeArchived ? 'ausblenden' : 'anzeigen'}
      </Button>
    </div>
  );
}

type EquipmentRowsProps = {
  filtered: EquipmentListItem[];
  visiblePending: EquipmentPendingDraft[];
};

function EquipmentCards({ filtered, visiblePending }: EquipmentRowsProps): ReactElement {
  return (
    <div className="space-y-2 md:hidden">
      {filtered.map((item) => (
        <ListRow key={item.id} asChild interactive>
          <Link href={equipmentHref(item.equipmentNumber)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {item.equipmentNumber} · {item.clientName} · {item.siteName}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">
              {stateLabel(item)}
            </span>
          </Link>
        </ListRow>
      ))}
      {visiblePending.map((draft) => (
        <ListRow
          key={draft.id}
          unconfirmed
          role="status"
          aria-label="Wird gespeichert"
          data-pending-row=""
          className="opacity-70"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-medium">
              <InlinePending active />
              <span className="truncate">{draft.name}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {draft.clientName} · {draft.siteName}
            </span>
          </span>
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">
            {EQUIPMENT_STATE_LABELS[draft.state]}
          </span>
        </ListRow>
      ))}
    </div>
  );
}

function EquipmentTable({ filtered, visiblePending }: EquipmentRowsProps): ReactElement {
  const router = useRouter();
  return (
    <div className="hidden rounded-lg border shadow-xs md:block">
      <Table>
        <TableHeader>
          <TableRow>
            {EQUIPMENT_COLUMNS.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((item) => {
            const href = equipmentHref(item.equipmentNumber);
            return (
              <TableRow key={item.id} interactive onClick={() => router.push(href)}>
                <TableCell>
                  <Link href={href} className="font-medium" onClick={(event) => event.stopPropagation()}>
                    {item.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {item.equipmentNumber} · {EQUIPMENT_CATEGORY_LABELS[item.category]}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block">{item.clientName}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3 shrink-0" />
                    {item.siteName}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[item.manufacturer, item.model].filter(Boolean).join(' · ') || 'Nicht erfasst'}
                </TableCell>
                <TableCell>
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {stateLabel(item)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
          {visiblePending.map((draft) => (
            <PendingRow
              key={draft.id}
              columns={EQUIPMENT_COLUMNS}
              cells={{
                equipment: (
                  <span>
                    <span className="block font-medium">{draft.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {EQUIPMENT_CATEGORY_LABELS[draft.category]}
                    </span>
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
                manufacturer: (
                  <span className="text-muted-foreground">
                    {[draft.manufacturer, draft.model].filter(Boolean).join(' · ') || 'Nicht erfasst'}
                  </span>
                ),
                state: (
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {EQUIPMENT_STATE_LABELS[draft.state]}
                  </span>
                ),
              }}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type EquipmentListContentProps = {
  initialPage: EquipmentPage;
  query: EquipmentListQuery;
};

/**
 * The server selects the page: scope, search and the count apply in the
 * database before the page boundary, and the URL owns that state. The chosen
 * filters stay ahead of the URL while the read is under way, so they react in
 * the first frame; each committed query remounts the results.
 */
export function EquipmentListContent({ initialPage, query }: EquipmentListContentProps): ReactElement {
  const navigation = useListNavigation();
  const [filters, setFilters] = useState<EquipmentListFilters>(query);
  const shownFilters: EquipmentListFilters = navigation.busy ? filters : query;

  function changeFilters(changes: Partial<EquipmentListFilters>): void {
    setFilters({ ...shownFilters, ...changes });
    navigation.navigate(
      {
        ...(changes.search !== undefined ? { q: changes.search } : {}),
        ...(changes.category !== undefined
          ? { category: changes.category === 'all' ? null : changes.category }
          : {}),
        ...(changes.includeArchived !== undefined ? { archived: changes.includeArchived ? '1' : null } : {}),
        page: 1,
      },
      changes.search !== undefined ? 250 : 0,
    );
  }

  return (
    <div className="space-y-4">
      <EquipmentListFilterBar filters={shownFilters} onChange={changeFilters} />
      <EquipmentListResults
        key={`${query.search}|${query.category}|${query.includeArchived}|${query.page}`}
        initialPage={initialPage}
        query={query}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
    </div>
  );
}

type EquipmentListResultsProps = {
  initialPage: EquipmentPage;
  query: EquipmentListQuery;
  busy: boolean;
  onPageChange: (page: number) => void;
};

/** One committed page: its live read, the pending creations and the page controls. */
function EquipmentListResults({
  initialPage,
  query,
  busy,
  onPageChange,
}: EquipmentListResultsProps): ReactElement {
  const { activeOrgId } = useOrganization();
  // Reads over GET, outside the Server Action queue, through the reader of the
  // first render; a same-scope event during a read queues one follow-up.
  const live = useLiveView({
    tables: ['installed_equipment'],
    initialData: initialPage,
    coalesceWhileReading: true,
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'equipment-page',
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
  const [pendingCreates, setPendingCreates] = useState<EquipmentPendingDraft[]>([]);
  const liveRefresh = live.refresh;
  const liveInvalidate = live.invalidate;
  useEffect(() => {
    const listener = ({ draft, result }: EquipmentCreateSubmission) => {
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
  // Equipment numbers ascend, so a new record lands last; a Realtime read
  // that arrives before the settle read drops the placeholder by id.
  const visiblePending = pendingCreates.filter(
    (draft) => !page.equipment.some((item) => item.id === draft.id),
  );

  return (
    <UsableContent name="anlagen" count={page.equipment.length}>
      {live.isStale && (
        <SectionError onRetry={() => void live.refresh()} retryPending={live.isRefreshing}>
          Die angezeigten Anlagendaten konnten nicht aktualisiert werden.
        </SectionError>
      )}
      {page.equipment.length === 0 && visiblePending.length === 0 ? (
        page.hasAnyEquipment ? (
          <EmptyState
            icon={Wrench}
            title="Keine Anlagen gefunden"
            description="Zu Suche und Filtern gibt es keine Anlage. Ändere die Suche oder blende archivierte Anlagen ein."
          />
        ) : (
          <EmptyState
            icon={Wrench}
            title="Noch keine Anlagen"
            description="Erfasse die erste installierte Anlage über „Anlage erfassen“."
          />
        )
      ) : (
        <>
          <EquipmentCards filtered={page.equipment} visiblePending={visiblePending} />
          <EquipmentTable filtered={page.equipment} visiblePending={visiblePending} />
        </>
      )}
      <ListPagination
        label="Anlagen"
        page={query.page}
        total={page.total}
        busy={busy}
        onPageChange={onPageChange}
      />
    </UsableContent>
  );
}

export function EquipmentCreateButton(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Anlage erfassen
      </Button>
      {open && (
        <EquipmentFormDialog open onOpenChange={setOpen} mode="create" onSubmitted={announceSubmission} />
      )}
    </>
  );
}
