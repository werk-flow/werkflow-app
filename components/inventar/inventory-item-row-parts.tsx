'use client';

import type { ReactNode } from 'react';
import { MoreHorizontal, Pencil, SlidersHorizontal } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlinePending } from '@/components/ui/inline-pending';
import { TableCell } from '@/components/ui/table';
import type { InventoryOverviewItem } from '@/lib/inventory/types';
import {
  formatInventoryQuantity,
  INVENTORY_ITEM_TYPE_LABELS,
  INVENTORY_STOCK_STATUS_LABELS,
} from '@/lib/inventory/types';
import { cn } from '@/lib/utils';
import type { PendingItemDraft } from './inventory-form-state';
import { itemTypeClasses, stockStatusClasses } from './inventory-row-format';

type ItemRowActions = {
  onEdit: (item: InventoryOverviewItem) => void;
  onAdjust: (item: InventoryOverviewItem) => void;
};

/** The mobile card content of a stored item. */
export function InventoryItemCardBody({
  item,
  busy,
}: {
  item: InventoryOverviewItem;
  /** The item's dialog edit is still settling. */
  busy: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
        <InlinePending active={busy} />
        <Badge variant="outline" className={cn('shrink-0', stockStatusClasses(item.stockStatus))}>
          {INVENTORY_STOCK_STATUS_LABELS[item.stockStatus]}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span>{INVENTORY_ITEM_TYPE_LABELS[item.itemType]}</span>
        {item.internalSku && <span>SKU {item.internalSku}</span>}
        {item.categoryName && <span>{item.categoryName}</span>}
      </div>
      <p className="text-xs tabular-nums">
        <span className="font-medium">
          {formatInventoryQuantity(item.availableQuantity, item.unit)} verfügbar
        </span>
        <span className="text-muted-foreground">
          {' '}
          · Bestand {formatInventoryQuantity(item.totalOnHand, item.unit)} · Geplant{' '}
          {formatInventoryQuantity(item.plannedQuantity, item.unit)}
        </span>
      </p>
      {item.stockByLocation.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {item.stockByLocation
            .slice(0, 2)
            .map(
              (stock) => `${stock.locationName} ${formatInventoryQuantity(stock.quantityOnHand, item.unit)}`,
            )
            .join(' · ')}
          {item.stockByLocation.length > 2 && ` · +${item.stockByLocation.length - 2} weitere`}
        </p>
      )}
    </div>
  );
}

/** The mobile card content of an item that is still being created. */
export function PendingItemCardBody({ item, label }: { item: PendingItemDraft; label: string }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-center gap-2">
        <InlinePending active label={label} />
        <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span>{INVENTORY_ITEM_TYPE_LABELS[item.itemType]}</span>
        {item.internalSku && <span>SKU {item.internalSku}</span>}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        Bestand {formatInventoryQuantity(item.quantity, item.unit)}
        {item.locationName && ` · ${item.locationName}`}
      </p>
    </div>
  );
}

/** The desktop table cells of a stored item, in column order. */
export function InventoryItemCells({
  item,
  busy,
  onEdit,
  onAdjust,
}: ItemRowActions & {
  item: InventoryOverviewItem;
  busy: boolean;
}) {
  return (
    <>
      <TableCell>
        <div className="min-w-48">
          <div className="flex items-center gap-2">
            <p className="font-medium">{item.name}</p>
            <InlinePending active={busy} />
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {item.internalSku && <span>SKU {item.internalSku}</span>}
            {item.primaryBarcode && <span>Barcode {item.primaryBarcode}</span>}
            {item.categoryName && <span>{item.categoryName}</span>}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={itemTypeClasses(item.itemType)}>
          {INVENTORY_ITEM_TYPE_LABELS[item.itemType]}
        </Badge>
      </TableCell>
      <TableCell>
        {item.stockByLocation.length === 0 ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <div className="space-y-1">
            {item.stockByLocation.slice(0, 2).map((stock) => (
              <div key={stock.locationId} className="text-xs">
                <span className="font-medium">{stock.locationName}</span>{' '}
                <span className="text-muted-foreground">
                  {formatInventoryQuantity(stock.quantityOnHand, item.unit)}
                </span>
              </div>
            ))}
            {item.stockByLocation.length > 2 && (
              <p className="text-xs text-muted-foreground">+{item.stockByLocation.length - 2} weitere</p>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatInventoryQuantity(item.totalOnHand, item.unit)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatInventoryQuantity(item.plannedQuantity, item.unit)}
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {formatInventoryQuantity(item.availableQuantity, item.unit)}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={stockStatusClasses(item.stockStatus)}>
          {INVENTORY_STOCK_STATUS_LABELS[item.stockStatus]}
        </Badge>
      </TableCell>
      <TableCell>
        <ItemActionsMenu item={item} onEdit={onEdit} onAdjust={onAdjust} />
      </TableCell>
    </>
  );
}

/** The known cell values of an item that is still being created, by column id. */
export function pendingItemRowCells(item: PendingItemDraft): Partial<Record<string, ReactNode>> {
  return {
    name: (
      <div className="min-w-48">
        <p className="font-medium">{item.name}</p>
        {item.internalSku && <p className="mt-1 text-xs text-muted-foreground">SKU {item.internalSku}</p>}
      </div>
    ),
    type: (
      <Badge variant="secondary" className={itemTypeClasses(item.itemType)}>
        {INVENTORY_ITEM_TYPE_LABELS[item.itemType]}
      </Badge>
    ),
    location: item.locationName ? (
      <span className="text-xs">
        <span className="font-medium">{item.locationName}</span>{' '}
        <span className="text-muted-foreground">{formatInventoryQuantity(item.quantity, item.unit)}</span>
      </span>
    ) : (
      <span className="text-muted-foreground">-</span>
    ),
    onHand: <span className="ml-auto tabular-nums">{formatInventoryQuantity(item.quantity, item.unit)}</span>,
    planned: (
      <span className="ml-auto tabular-nums text-muted-foreground">
        {formatInventoryQuantity(0, item.unit)}
      </span>
    ),
    available: (
      <span className="ml-auto tabular-nums font-medium">
        {formatInventoryQuantity(item.quantity, item.unit)}
      </span>
    ),
  };
}

export function ItemActionsMenu({
  item,
  onEdit,
  onAdjust,
}: ItemRowActions & { item: InventoryOverviewItem }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Aktionen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onAdjust(item)}>
          <SlidersHorizontal className="mr-2 size-4" />
          Bestand ändern
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(item)}>
          <Pencil className="mr-2 size-4" />
          Bearbeiten
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
