import type { ReactNode } from 'react';

import { formatInventoryQuantity } from '@/lib/inventory/types';
import { cn } from '@/lib/utils';
import { openMaterialQuantity } from './job-material-dialog-model';

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
 * the booked facts read as one plain line („5 m entnommen · 3 m verbraucht ·
 * 2 m zurück“), never as a shortage. Once something was used or returned,
 * what is still neither reads „noch offen“.
 */
export function MaterialQuantityPills({
  unit,
  plannedQuantity,
  takenQuantity,
  usedQuantity,
  returnedQuantity,
  billableQuantity,
}: {
  unit: string;
  plannedQuantity: number;
  takenQuantity: number;
  usedQuantity: number;
  returnedQuantity: number;
  /** Null for a reader who must not see the billable quantity. */
  billableQuantity: number | null;
}) {
  const openQuantity = openMaterialQuantity({ takenQuantity, usedQuantity, returnedQuantity });
  const facts = [
    takenQuantity > 0 && `${formatInventoryQuantity(takenQuantity, unit)} entnommen`,
    usedQuantity > 0 && `${formatInventoryQuantity(usedQuantity, unit)} verbraucht`,
    returnedQuantity > 0 && `${formatInventoryQuantity(returnedQuantity, unit)} zurück`,
    (usedQuantity > 0 || returnedQuantity > 0) &&
      openQuantity > 0 &&
      `${formatInventoryQuantity(openQuantity, unit)} noch offen`,
  ].filter((fact) => typeof fact === 'string');
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {plannedQuantity > 0 && (
        <MovementPill tone="planned">Bedarf {formatInventoryQuantity(plannedQuantity, unit)}</MovementPill>
      )}
      {facts.length > 0 && <MovementPill tone="booked">{facts.join(' · ')}</MovementPill>}
      {billableQuantity !== null && billableQuantity > 0 && (
        <MovementPill tone="planned">
          Abrechenbar {formatInventoryQuantity(billableQuantity, unit)}
        </MovementPill>
      )}
    </div>
  );
}
