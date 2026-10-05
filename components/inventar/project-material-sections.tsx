'use client';

import { useId } from 'react';

import { Badge } from '@/components/ui/badge';
import type { InventoryLocation, ProjectMaterialSummary } from '@/lib/inventory/types';
import { formatInventoryQuantity } from '@/lib/inventory/types';
import { MaterialLineRow } from './job-material-line-row';
import { MovementPill } from './material-movement-pill';

/** The read-only material lines a project inherits from its jobs. */
export function InheritedJobMaterialGroups({
  groups,
  locations,
  isAdminOrManager,
}: {
  groups: ProjectMaterialSummary['jobGroups'];
  locations: InventoryLocation[];
  isAdminOrManager: boolean;
}) {
  return (
    <div className="mt-5 space-y-3 border-t pt-4">
      <div>
        <h4 className="text-sm font-semibold">Aus Aufträgen übernommen</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Diese Positionen gehören zu Aufträgen innerhalb dieses Projekts.
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.jobId} className="rounded-md border bg-background/70 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{group.jobNumber ? `Auftrag ${group.jobNumber}` : 'Auftrag'}</Badge>
            <span className="text-sm font-medium">{group.jobTitle}</span>
          </div>
          <div className="space-y-2">
            {group.lines.map((line) => (
              <MaterialLineRow
                key={line.id}
                line={line}
                isAdminOrManager={false}
                showBillableData={isAdminOrManager}
                isBusy={false}
                locations={locations}
                readOnly
                onTake={() => undefined}
                onReturn={() => undefined}
                onEdit={() => undefined}
                onDelete={() => undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The per-item totals over a project and its jobs. */
export function ProjectMaterialTotals({
  totals,
  isAdminOrManager,
}: {
  totals: ProjectMaterialSummary['totals'];
  isAdminOrManager: boolean;
}) {
  const titleId = useId();
  return (
    <div className="mt-5 border-t pt-4" role="region" aria-labelledby={titleId}>
      <h4 id={titleId} className="mb-3 text-sm font-semibold">
        Projekt gesamt
      </h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {totals.map((total) => (
          <div
            key={`${total.itemId}-${total.unit}`}
            data-row-id={total.itemId}
            className="rounded-md border bg-background px-3 py-2"
          >
            <p className="truncate text-sm font-medium">{total.itemName}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {total.plannedQuantity > 0 && (
                <MovementPill tone="planned">
                  Bedarf {formatInventoryQuantity(total.plannedQuantity, total.unit)}
                </MovementPill>
              )}
              {total.takenQuantity > 0 && (
                <MovementPill tone="take">
                  -{formatInventoryQuantity(total.takenQuantity, total.unit)}
                </MovementPill>
              )}
              {total.returnedQuantity > 0 && (
                <MovementPill tone="return">
                  +{formatInventoryQuantity(total.returnedQuantity, total.unit)}
                </MovementPill>
              )}
              {isAdminOrManager && total.billableQuantity > 0 && (
                <MovementPill tone="planned">
                  Abrechenbar {formatInventoryQuantity(total.billableQuantity, total.unit)}
                </MovementPill>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
