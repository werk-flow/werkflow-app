import type { ReactNode } from 'react';

import { formatInventoryQuantity } from '@/lib/inventory/types';
import { cn } from '@/lib/utils';

function MovementPill({ tone, children }: { tone: 'planned' | 'booked'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        tone === 'planned' && 'bg-info-soft text-info-soft-foreground',
        tone === 'booked' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

/**
 * A material line's quantities. A take is the normal course of a job, so
 * taken and returned quantities read as plain facts, never as a shortage.
 */
export function MaterialQuantityPills({
  unit,
  plannedQuantity,
  takenQuantity,
  returnedQuantity,
  billableQuantity,
}: {
  unit: string;
  plannedQuantity: number;
  takenQuantity: number;
  returnedQuantity: number;
  /** Null for a reader who must not see the billable quantity. */
  billableQuantity: number | null;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {plannedQuantity > 0 && (
        <MovementPill tone="planned">Bedarf {formatInventoryQuantity(plannedQuantity, unit)}</MovementPill>
      )}
      {takenQuantity > 0 && (
        <MovementPill tone="booked">{formatInventoryQuantity(takenQuantity, unit)} entnommen</MovementPill>
      )}
      {returnedQuantity > 0 && (
        <MovementPill tone="booked">
          {formatInventoryQuantity(returnedQuantity, unit)} zurückgelegt
        </MovementPill>
      )}
      {billableQuantity !== null && billableQuantity > 0 && (
        <MovementPill tone="planned">
          Abrechenbar {formatInventoryQuantity(billableQuantity, unit)}
        </MovementPill>
      )}
    </div>
  );
}
