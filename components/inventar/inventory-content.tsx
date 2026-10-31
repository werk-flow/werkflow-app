'use client';

import { useMemo, useState } from 'react';
import { FileUp, Plus, Warehouse } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { PendingRow } from '@/components/ui/pending-row';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  INVENTORY_ITEM_COLUMNS,
  INVENTORY_MOVEMENT_COLUMNS,
} from '@/components/inventar/inventory-table-columns';
import { ListPagination } from '@/components/shared/list-pagination';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { isServerRow, withPendingDraft } from '@/lib/inventory/pending-drafts';
import type { InventoryOverview, InventoryOverviewItem } from '@/lib/inventory/types';
import { INVENTORY_MOVEMENT_TYPE_LABELS } from '@/lib/inventory/types';
import { cn, formatBerlinDateTime } from '@/lib/utils';
import { InventoryDialogs } from './inventory-dialogs';
import { InventoryFilterBar } from './inventory-filter-bar';
import type { PendingItemDraft } from './inventory-form-state';
import {
  InventoryItemCardBody,
  InventoryItemCells,
  ItemActionsMenu,
  PendingItemCardBody,
  pendingItemRowCells,
} from './inventory-item-row-parts';
import { LocationsView } from './inventory-locations-view';
import { formatMovementTarget } from './inventory-row-format';
import { InventorySummaryTiles } from './inventory-summary-tiles';
import { useInventoryEditing } from './use-inventory-editing';
import { useInventoryFilters } from './use-inventory-filters';

type InventoryContentProps = {
  overview: InventoryOverview;
};

export function InventoryContent({ overview }: InventoryContentProps) {
  const navigation = useListNavigation();
  const query = overview.page.query;
  const filters = useInventoryFilters(query, navigation);
  const editing = useInventoryEditing(overview);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  useRealtimeRouterRefresh({
    tables: [
      'inventory_categories',
      'inventory_locations',
      'inventory_suppliers',
      'inventory_items',
      'inventory_item_barcodes',
      'inventory_stock_levels',
      'inventory_import_batches',
      'job_material_lines',
      'inventory_movements',
      'inventory_asset_instances',
    ],
  });

  const pageItems = useMemo(() => {
    const byId = new Map(overview.items.map((item) => [item.id, item]));
    return overview.page.ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }, [overview.items, overview.page.ids]);
  const filteredItems = pageItems;
  const plannedItems = pageItems;

  return (
    <PageShell>
      <PageHeader
        title="Inventar"
        subtitle={`${overview.summary.totalItems} Artikel · ${overview.locations.length} Lager · ${overview.summary.plannedItems} geplante Artikel`}
        actions={
          <InventoryHeaderActions
            onImport={() => setImportDialogOpen(true)}
            onCreateLocation={editing.location.openCreate}
            onCreateItem={editing.item.openCreate}
          />
        }
      />

      <PageBody>
        <InventorySummaryTiles summary={overview.summary} />

        <InventoryTabs
          overview={overview}
          navigation={navigation}
          filters={filters}
          editing={editing}
          filteredItems={filteredItems}
          plannedItems={plannedItems}
        />
        {query.tab !== 'movements' && (
          <ListPagination
            page={query.page}
            total={query.tab === 'locations' ? overview.locations.length : overview.page.total}
            pageSize={query.tab === 'locations' ? 12 : 50}
            busy={navigation.busy}
            label={query.tab === 'locations' ? 'Lagerseiten' : 'Artikelseiten'}
            onPageChange={(page) => navigation.navigate({ page })}
          />
        )}
      </PageBody>

      <InventoryDialogs
        overview={overview}
        editing={editing}
        importDialogOpen={importDialogOpen}
        setImportDialogOpen={setImportDialogOpen}
      />
    </PageShell>
  );
}

function InventoryHeaderActions({
  onImport,
  onCreateLocation,
  onCreateItem,
}: {
  onImport: () => void;
  onCreateLocation: () => void;
  onCreateItem: () => void;
}) {
  return (
    <>
      <Button variant="outline" className="gap-2" onClick={onImport}>
        <FileUp className="size-4" />
        CSV importieren
      </Button>
      <Button variant="outline" className="gap-2" onClick={onCreateLocation}>
        <Warehouse className="size-4" />
        Lager anlegen
      </Button>
      <Button className="gap-2" onClick={onCreateItem}>
        <Plus className="size-4" />
        Artikel anlegen
      </Button>
    </>
  );
}

/** The four tabs with the filter bar; the URL holds the open tab. */
function InventoryTabs({
  overview,
  navigation,
  filters,
  editing,
  filteredItems,
  plannedItems,
}: {
  overview: InventoryOverview;
  navigation: ReturnType<typeof useListNavigation>;
  filters: ReturnType<typeof useInventoryFilters>;
  editing: ReturnType<typeof useInventoryEditing>;
  filteredItems: InventoryOverviewItem[];
  plannedItems: InventoryOverviewItem[];
}) {
  return (
    <Tabs
      value={overview.page.query.tab}
      onValueChange={(tab) => navigation.navigate({ tab, page: 1 })}
      className="mt-4"
    >
      {/* One row only where tabs and all four filters fit beside the sidebar. */}
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <TabsList>
          <TabsTrigger value="all">Alle Artikel</TabsTrigger>
          <TabsTrigger value="locations">Lager</TabsTrigger>
          <TabsTrigger value="planned">Geplant</TabsTrigger>
          <TabsTrigger value="movements">Bewegungen</TabsTrigger>
        </TabsList>

        <InventoryFilterBar filters={filters} locations={overview.locations} />
      </div>

      <TabsContent value="all" className="mt-4" aria-busy={navigation.busy} inert={navigation.busy}>
        <InventoryTable
          items={filteredItems}
          pendingDraft={editing.item.pendingDraft}
          isBusy={editing.isItemBusy}
          onEdit={editing.item.openEdit}
          onAdjust={editing.stock.open}
        />
      </TabsContent>

      <TabsContent value="locations" className="mt-4" aria-busy={navigation.busy} inert={navigation.busy}>
        <LocationsView
          locations={overview.locations.filter((location) => overview.page.locationIds.includes(location.id))}
          items={overview.items}
          itemCounts={overview.page.locationCounts}
          pendingDraft={editing.location.pendingDraft}
        />
      </TabsContent>

      <TabsContent value="planned" className="mt-4" aria-busy={navigation.busy} inert={navigation.busy}>
        <InventoryTable
          items={plannedItems}
          isBusy={editing.isItemBusy}
          onEdit={editing.item.openEdit}
          onAdjust={editing.stock.open}
        />
      </TabsContent>

      <TabsContent value="movements" className="mt-4" aria-busy={navigation.busy} inert={navigation.busy}>
        <MovementsTable movements={overview.movements} />
      </TabsContent>
    </Tabs>
  );
}

const PENDING_ITEM_LABEL = 'Artikel wird angelegt';

type InventoryRowActions = {
  /** The row whose dialog edit is still settling shows an inline indicator. */
  isBusy: (itemId: string) => boolean;
  onEdit: (item: InventoryOverviewItem) => void;
  onAdjust: (item: InventoryOverviewItem) => void;
};

type InventoryTableRows = InventoryRowActions & {
  rows: Array<InventoryOverviewItem | PendingItemDraft>;
};

function InventoryTable({
  items,
  pendingDraft = null,
  isBusy,
  onEdit,
  onAdjust,
}: InventoryRowActions & {
  items: InventoryOverviewItem[];
  pendingDraft?: PendingItemDraft | null;
}) {
  const rows = withPendingDraft(items, pendingDraft);

  return (
    <>
      <InventoryItemCards rows={rows} isBusy={isBusy} onEdit={onEdit} onAdjust={onAdjust} />
      <InventoryItemsDesktopTable rows={rows} isBusy={isBusy} onEdit={onEdit} onAdjust={onAdjust} />
    </>
  );
}

function InventoryItemCards({ rows, isBusy, onEdit, onAdjust }: InventoryTableRows) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.length === 0 ? (
        <EmptyState
          title="Keine Artikel gefunden"
          description="Ändere die Suche oder die Filter, oder lege über „Artikel anlegen“ einen Artikel an."
        />
      ) : (
        rows.map((item) =>
          isServerRow(item) ? (
            <ListRow key={item.id} className="items-start">
              <InventoryItemCardBody item={item} busy={isBusy(item.id)} />
              <ItemActionsMenu item={item} onEdit={onEdit} onAdjust={onAdjust} />
            </ListRow>
          ) : (
            <ListRow
              key="pending-item"
              unconfirmed
              role="status"
              aria-label={PENDING_ITEM_LABEL}
              className="items-start opacity-70"
            >
              <PendingItemCardBody item={item} label={PENDING_ITEM_LABEL} />
            </ListRow>
          ),
        )
      )}
    </div>
  );
}

function InventoryItemsDesktopTable({ rows, isBusy, onEdit, onAdjust }: InventoryTableRows) {
  return (
    <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
      <Table>
        <TableHeader>
          <TableRow>
            {INVENTORY_ITEM_COLUMNS.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={INVENTORY_ITEM_COLUMNS.length}>
                <EmptyState
                  title="Keine Artikel gefunden"
                  description="Ändere die Suche oder die Filter, oder lege über „Artikel anlegen“ einen Artikel an."
                />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((item) =>
              isServerRow(item) ? (
                <TableRow key={item.id}>
                  <InventoryItemCells
                    item={item}
                    busy={isBusy(item.id)}
                    onEdit={onEdit}
                    onAdjust={onAdjust}
                  />
                </TableRow>
              ) : (
                <PendingRow
                  key="pending-item"
                  columns={INVENTORY_ITEM_COLUMNS}
                  label={PENDING_ITEM_LABEL}
                  cells={pendingItemRowCells(item)}
                />
              ),
            )
          )}
        </TableBody>
      </Table>
    </div>
  );
}

type InventoryMovements = { movements: InventoryOverview['movements'] };

function MovementsTable({ movements }: InventoryMovements) {
  return (
    <>
      <MovementCards movements={movements} />
      <MovementsDesktopTable movements={movements} />
    </>
  );
}

function MovementCards({ movements }: InventoryMovements) {
  return (
    <div className="space-y-2 md:hidden">
      {movements.length === 0 ? (
        <EmptyState
          title="Noch keine Bewegungen"
          description="Zugänge, Entnahmen und Umlagerungen erscheinen hier, sobald Bestand gebucht wird."
        />
      ) : (
        movements.map((movement) => {
          const target = formatMovementTarget(movement);
          return (
            <ListRow key={movement.id} className="items-start">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{movement.itemName}</p>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-medium tabular-nums',
                      movement.quantityDelta < 0 ? 'text-destructive' : 'text-success-text',
                    )}
                  >
                    {movement.quantityDelta > 0 ? '+' : ''}
                    {movement.quantityDelta.toLocaleString('de-DE')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {INVENTORY_MOVEMENT_TYPE_LABELS[movement.movementType]} ·{' '}
                  {formatBerlinDateTime(movement.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {target.from} → {target.to}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  Vorher {movement.quantityBefore.toLocaleString('de-DE')} · Danach{' '}
                  {movement.quantityAfter.toLocaleString('de-DE')}
                </p>
                {movement.reason && <p className="text-xs text-muted-foreground">Grund: {movement.reason}</p>}
              </div>
            </ListRow>
          );
        })
      )}
    </div>
  );
}

function MovementsDesktopTable({ movements }: InventoryMovements) {
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
          {movements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={INVENTORY_MOVEMENT_COLUMNS.length}>
                <EmptyState
                  title="Noch keine Bewegungen"
                  description="Zugänge, Entnahmen und Umlagerungen erscheinen hier, sobald Bestand gebucht wird."
                />
              </TableCell>
            </TableRow>
          ) : (
            movements.map((movement) => {
              const target = formatMovementTarget(movement);
              return (
                <TableRow key={movement.id}>
                  <TableCell className="text-muted-foreground">
                    {formatBerlinDateTime(movement.createdAt)}
                  </TableCell>
                  <TableCell className="font-medium wrap-anywhere">{movement.itemName}</TableCell>
                  <TableCell className="wrap-anywhere">{movement.locationName}</TableCell>
                  <TableCell className="wrap-anywhere">{target.from}</TableCell>
                  <TableCell className="wrap-anywhere">{target.to}</TableCell>
                  <TableCell>{INVENTORY_MOVEMENT_TYPE_LABELS[movement.movementType]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {movement.quantityBefore.toLocaleString('de-DE')}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      movement.quantityDelta < 0 ? 'text-destructive' : 'text-success-text',
                    )}
                  >
                    {movement.quantityDelta > 0 ? '+' : ''}
                    {movement.quantityDelta.toLocaleString('de-DE')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {movement.quantityAfter.toLocaleString('de-DE')}
                  </TableCell>
                  <TableCell>{movement.reason ?? '—'}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
