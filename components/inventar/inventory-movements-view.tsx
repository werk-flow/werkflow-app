'use client';

import { History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SearchInput } from '@/components/ui/search-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { ListPagination } from '@/components/shared/list-pagination';
import { RegionLoadError } from '@/components/shared/region-load-error';
import type {
  InventoryHistoryKind,
  InventoryLocation,
  InventoryMovementHistoryEntry,
  InventoryMovementPage,
} from '@/lib/inventory/types';
import { INVENTORY_HISTORY_KIND_LABELS, formatInventoryQuantity } from '@/lib/inventory/types';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { cn, formatBerlinDateTime, parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import { INVENTORY_MOVEMENT_COLUMNS } from './inventory-table-columns';
import { formatMovementTarget, movesStock, type MovementEnd } from './inventory-row-format';
import type { InventoryFilters } from './use-inventory-filters';

const ALL_VALUE = 'all';

/** The kinds the app books today; older kinds still show under „Alle Bewegungen“. */
const KIND_FILTER_OPTIONS: readonly InventoryHistoryKind[] = [
  'initial_count',
  'stock_in',
  'stock_out',
  'job_take',
  'job_use',
  'job_use_correction',
  'job_return',
];

/**
 * The movement history of `/inventar`: every stock movement and every use of
 * job material, read page by page on the server with its filters and total.
 */
export function InventoryMovementsView({
  history,
  filters,
  locations,
  page,
  busy,
  onPageChange,
}: {
  history: InventoryMovementPage;
  filters: InventoryFilters;
  locations: InventoryLocation[];
  page: number;
  busy: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="space-y-4">
      <MovementFilterBar
        filters={filters}
        locations={locations}
        people={history.status === 'loaded' ? history.people : []}
      />
      {history.status === 'failed' ? (
        <RegionLoadError title="Bewegungen nicht geladen">
          Die Bewegungen konnten nicht geladen werden. Versuche es noch einmal.
        </RegionLoadError>
      ) : (
        <div className="space-y-4" aria-busy={busy} inert={busy}>
          {history.entries.length === 0 ? (
            <MovementsEmptyState hasAny={history.hasAny} onReset={filters.resetHistoryFilters} />
          ) : (
            <>
              <MovementCards entries={history.entries} />
              <MovementsDesktopTable entries={history.entries} />
            </>
          )}
          <ListPagination
            page={page}
            total={history.total}
            pageSize={LIST_PAGE_SIZE}
            busy={busy}
            label="Bewegungsseiten"
            onPageChange={onPageChange}
          />
        </div>
      )}
    </div>
  );
}

function MovementFilterBar({
  filters,
  locations,
  people,
}: {
  filters: InventoryFilters;
  locations: InventoryLocation[];
  people: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
      <SearchInput
        wrapperClassName="min-w-0 sm:col-span-2 lg:w-64"
        value={filters.search}
        onValueChange={filters.changeSearch}
        placeholder="Artikel suchen"
        aria-label="Artikel suchen"
      />
      <div className="min-w-0 lg:w-44">
        <SearchableSelect
          ariaLabel="Nach Lager filtern"
          options={[
            { value: ALL_VALUE, label: 'Alle Lager' },
            ...locations.map((location) => ({ value: location.id, label: location.name })),
          ]}
          value={filters.locationFilter}
          onChange={filters.changeLocation}
          searchPlaceholder="Lager suchen …"
          emptyMessage="Kein Lager gefunden"
        />
      </div>
      <Select value={filters.kindFilter} onValueChange={filters.changeKind}>
        <SelectTrigger className="min-w-0 lg:w-52" aria-label="Nach Bewegung filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>Alle Bewegungen</SelectItem>
          {KIND_FILTER_OPTIONS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {INVENTORY_HISTORY_KIND_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-w-0 lg:w-48">
        <SearchableSelect
          ariaLabel="Nach Person filtern"
          options={[
            { value: ALL_VALUE, label: 'Alle Personen' },
            ...people.map((person) => ({ value: person.id, label: person.name })),
          ]}
          value={filters.personFilter}
          onChange={filters.changePerson}
          searchPlaceholder="Person suchen …"
          emptyMessage="Keine Person gefunden"
        />
      </div>
      <DateBound label="Von" ariaLabel="Bewegungen ab" value={filters.fromDate} onChange={filters.changeFromDate} />
      <DateBound label="Bis" ariaLabel="Bewegungen bis" value={filters.toDate} onChange={filters.changeToDate} />
    </div>
  );
}

function DateBound({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 lg:w-40">
      <DatePicker
        value={value ? parseIsoLocalDate(value) : undefined}
        onChange={(date) => onChange(date ? toLocalDateString(date) : '')}
        placeholder={label}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}

function MovementsEmptyState({ hasAny, onReset }: { hasAny: boolean; onReset: () => void }) {
  return hasAny ? (
    <EmptyState
      icon={History}
      title="Keine Bewegungen gefunden"
      description="Zu dieser Suche und diesen Filtern gibt es keine Bewegung."
      action={
        <Button variant="outline" onClick={onReset}>
          Filter zurücksetzen
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={History}
      title="Noch keine Bewegungen"
      description="Zugänge, Entnahmen, Verbrauch und Rückgaben erscheinen hier, sobald Material gebucht wird."
    />
  );
}

function MovementEndLabel({ end }: { end: MovementEnd }) {
  return end.href ? <TextLink href={end.href}>{end.label}</TextLink> : <>{end.label}</>;
}

/** A stock movement's signed change, or a use's quantity, which moves no stock. */
function MovementQuantity({ entry }: { entry: InventoryMovementHistoryEntry }) {
  const stock = movesStock(entry);
  return (
    <span
      className={cn(
        'tabular-nums',
        !stock && 'text-muted-foreground',
        stock && (entry.quantity < 0 ? 'text-destructive' : 'text-success-text'),
      )}
    >
      {stock && entry.quantity > 0 ? '+' : ''}
      {formatInventoryQuantity(entry.quantity, entry.unit, 3)}
    </span>
  );
}

const formatStockQuantity = (quantity: number | null): string =>
  quantity === null ? '—' : quantity.toLocaleString('de-DE');

function MovementCards({ entries }: { entries: InventoryMovementHistoryEntry[] }) {
  return (
    <ul className="space-y-2 md:hidden" aria-label="Bewegungen">
      {entries.map((entry) => {
        const target = formatMovementTarget(entry);
        return (
          <ListRow asChild key={entry.id} className="items-start">
            <li>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium wrap-anywhere">{entry.itemName}</p>
                  <span className="shrink-0 text-sm font-medium">
                    <MovementQuantity entry={entry} />
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {INVENTORY_HISTORY_KIND_LABELS[entry.kind]} · {formatBerlinDateTime(entry.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground wrap-anywhere">
                  <MovementEndLabel end={target.from} /> → <MovementEndLabel end={target.to} />
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {movesStock(entry)
                    ? `Vorher ${formatStockQuantity(entry.quantityBefore)} · Danach ${formatStockQuantity(entry.quantityAfter)}`
                    : 'Bestand bleibt gleich'}
                </p>
                {entry.actorName && <p className="text-xs text-muted-foreground">Von {entry.actorName}</p>}
                {entry.reason && <p className="text-xs text-muted-foreground">Grund: {entry.reason}</p>}
              </div>
            </li>
          </ListRow>
        );
      })}
    </ul>
  );
}

function MovementsDesktopTable({ entries }: { entries: InventoryMovementHistoryEntry[] }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
      <Table>
        <TableHeader>
          <TableRow>
            {INVENTORY_MOVEMENT_COLUMNS.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const target = formatMovementTarget(entry);
            return (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground">{formatBerlinDateTime(entry.createdAt)}</TableCell>
                <TableCell className="font-medium wrap-anywhere">{entry.itemName}</TableCell>
                <TableCell className="wrap-anywhere">{entry.locationName ?? '—'}</TableCell>
                <TableCell className="wrap-anywhere">
                  <MovementEndLabel end={target.from} />
                </TableCell>
                <TableCell className="wrap-anywhere">
                  <MovementEndLabel end={target.to} />
                </TableCell>
                <TableCell>{INVENTORY_HISTORY_KIND_LABELS[entry.kind]}</TableCell>
                <TableCell className="text-right tabular-nums">{formatStockQuantity(entry.quantityBefore)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <MovementQuantity entry={entry} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatStockQuantity(entry.quantityAfter)}</TableCell>
                <TableCell className="wrap-anywhere">{entry.actorName ?? '—'}</TableCell>
                <TableCell className="wrap-anywhere">{entry.reason ?? '—'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
