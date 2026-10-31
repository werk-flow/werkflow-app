'use client';

import { CheckCircle2, Pencil, RotateCcw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type { InventoryLocation, JobMaterialLine } from '@/lib/inventory/types';
import {
  formatInventoryQuantity,
  INVENTORY_ITEM_TYPE_LABELS,
  JOB_MATERIAL_STATUS_LABELS,
} from '@/lib/inventory/types';
import { cn } from '@/lib/utils';
import { MovementPill } from './material-movement-pill';

function statusClasses(status: JobMaterialLine['status']): string {
  switch (status) {
    case 'planned':
      return 'bg-info-soft text-info-soft-foreground';
    case 'partially_taken':
      return 'bg-warning-soft text-warning-soft-foreground';
    case 'taken':
      return 'bg-success-soft text-success-soft-foreground';
    case 'returned':
      return 'bg-success-soft text-success-soft-foreground';
    case 'cancelled':
      return 'bg-muted text-muted-foreground';
  }
}

export function MaterialLineRow({
  line,
  isAdminOrManager,
  showBillableData = isAdminOrManager,
  isBusy,
  locations,
  readOnly = false,
  onTake,
  onReturn,
  onEdit,
  onDelete,
}: {
  line: JobMaterialLine;
  isAdminOrManager: boolean;
  showBillableData?: boolean;
  /** This line's own action is in flight or settling; other lines stay usable. */
  isBusy: boolean;
  locations: InventoryLocation[];
  readOnly?: boolean;
  onTake: () => void;
  onReturn: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const stillOut = Math.max(0, line.takenQuantity - line.returnedQuantity);

  return (
    <div className="@container rounded-md border bg-background p-3" data-testid="job-material-line">
      {/* The line sits in a half-width column on detail pages; it goes side by side only where its own width allows. */}
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <MaterialLineSummary
          line={line}
          isBusy={isBusy}
          showBillableData={showBillableData}
          stillOut={stillOut}
        />

        {!readOnly && (
          <MaterialLineActions
            isAdminOrManager={isAdminOrManager}
            isBusy={isBusy}
            locations={locations}
            stillOut={stillOut}
            onTake={onTake}
            onReturn={onReturn}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}

/** The line's item, status, booked quantities and Lager. */
function MaterialLineSummary({
  line,
  isBusy,
  showBillableData,
  stillOut,
}: {
  line: JobMaterialLine;
  isBusy: boolean;
  showBillableData: boolean;
  /** Taken and not returned yet. */
  stillOut: number;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{line.itemName}</p>
        <InlinePending active={isBusy} />
        <Badge variant="secondary" className="text-xs">
          {INVENTORY_ITEM_TYPE_LABELS[line.itemType]}
        </Badge>
        <Badge variant="secondary" className={statusClasses(line.status)}>
          {JOB_MATERIAL_STATUS_LABELS[line.status]}
        </Badge>
        {line.isUnplanned && (
          <Badge variant="outline" className="text-xs">
            Direkt entnommen
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {line.plannedQuantity > 0 && (
          <MovementPill tone="planned">
            Bedarf {formatInventoryQuantity(line.plannedQuantity, line.unit)}
          </MovementPill>
        )}
        {line.takenQuantity > 0 && (
          <MovementPill tone="take">-{formatInventoryQuantity(line.takenQuantity, line.unit)}</MovementPill>
        )}
        {line.returnedQuantity > 0 && (
          <MovementPill tone="return">
            +{formatInventoryQuantity(line.returnedQuantity, line.unit)}
          </MovementPill>
        )}
        {showBillableData && line.billableQuantity > 0 && (
          <MovementPill tone="planned">
            Abrechenbar {formatInventoryQuantity(line.billableQuantity, line.unit)}
          </MovementPill>
        )}
      </div>
      <div className="mt-2 grid gap-1 text-xs text-muted-foreground @md:grid-cols-2">
        <span>Lager: {line.preferredLocationName ?? 'Nicht festgelegt'}</span>
        <span>Noch draußen: {formatInventoryQuantity(stillOut, line.unit)}</span>
      </div>
      {line.notes && <p className="mt-2 text-xs text-muted-foreground">{line.notes}</p>}
    </div>
  );
}

/** Take, return, and for the office edit and remove; a busy line keeps them disabled. */
function MaterialLineActions({
  isAdminOrManager,
  isBusy,
  locations,
  stillOut,
  onTake,
  onReturn,
  onEdit,
  onDelete,
}: {
  isAdminOrManager: boolean;
  isBusy: boolean;
  locations: InventoryLocation[];
  stillOut: number;
  onTake: () => void;
  onReturn: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canReturn = stillOut > 0 && (locations.length > 0 || !isAdminOrManager);
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        className={cn('gap-1', isAdminOrManager ? 'h-8' : 'min-h-11')}
        onClick={onTake}
        // eslint-disable-next-line ui/action-disabled-only-while-pending -- availability: without a stock location there is nowhere to book from
        disabled={isBusy || (isAdminOrManager && locations.length === 0)}
      >
        <CheckCircle2 className="size-3.5" />
        Entnahme buchen
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn('gap-1', isAdminOrManager ? 'h-8' : 'min-h-11')}
        onClick={onReturn}
        // eslint-disable-next-line ui/action-disabled-only-while-pending -- availability: nothing taken out, or no stock location to return to
        disabled={isBusy || !canReturn}
      >
        <RotateCcw className="size-3.5" />
        Zurücklegen
      </Button>
      {isAdminOrManager && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={onEdit}
            disabled={isBusy}
            title="Position bearbeiten"
          >
            <Pencil className="size-3.5" />
            <span className="sr-only">Position bearbeiten</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={isBusy}
            title="Plan entfernen"
          >
            <Trash2 className="size-3.5" />
            <span className="sr-only">Plan entfernen</span>
          </Button>
        </>
      )}
    </div>
  );
}
