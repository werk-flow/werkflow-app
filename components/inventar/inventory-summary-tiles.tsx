import type { ReactNode } from 'react';
import { Boxes, ClipboardList, PackagePlus, SlidersHorizontal, TriangleAlert } from 'lucide-react';

import type { InventoryOverview } from '@/lib/inventory/types';
import { cn } from '@/lib/utils';

function SummaryTile({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border bg-card px-3 py-3', className)}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function InventorySummaryTiles({ summary }: { summary: InventoryOverview['summary'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <SummaryTile
        className="col-span-2 lg:col-span-1"
        label="Artikel mit Bestand"
        value={String(summary.stockedItems)}
        icon={<Boxes className="size-4" />}
      />
      <SummaryTile
        label="Geplante Artikel"
        value={String(summary.plannedItems)}
        icon={<PackagePlus className="size-4" />}
      />
      <SummaryTile
        label="Unterdeckt"
        value={String(summary.shortfallItems)}
        icon={<TriangleAlert className="size-4" />}
      />
      <SummaryTile
        label="Knapp"
        value={String(summary.lowStockItems)}
        icon={<SlidersHorizontal className="size-4" />}
      />
      <SummaryTile
        label="Leer"
        value={String(summary.outOfStockItems)}
        icon={<ClipboardList className="size-4" />}
      />
    </div>
  );
}
