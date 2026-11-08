import type { LucideIcon } from 'lucide-react';
import { Boxes, ClipboardList, PackagePlus, SlidersHorizontal, TriangleAlert } from 'lucide-react';

import type { InventoryOverview } from '@/lib/inventory/types';
import { cn } from '@/lib/utils';

// Below `sm` a tile is one line, label left and count right, so the five
// tiles take three short rows and the item list starts on a phone's first
// screen. From `sm` up it is the stacked tile with icon and uppercase label.
function SummaryTile({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 sm:block sm:py-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground sm:mb-2 sm:uppercase sm:tracking-wide">
        <Icon className="hidden size-4 shrink-0 sm:block" />
        {label}
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums sm:text-lg">{value}</p>
    </div>
  );
}

export function InventorySummaryTiles({ summary }: { summary: InventoryOverview['summary'] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
      <SummaryTile
        className="col-span-2 lg:col-span-1"
        label="Artikel mit Bestand"
        value={String(summary.stockedItems)}
        icon={Boxes}
      />
      <SummaryTile label="Geplante Artikel" value={String(summary.plannedItems)} icon={PackagePlus} />
      <SummaryTile label="Unterdeckt" value={String(summary.shortfallItems)} icon={TriangleAlert} />
      <SummaryTile label="Knapp" value={String(summary.lowStockItems)} icon={SlidersHorizontal} />
      <SummaryTile label="Leer" value={String(summary.outOfStockItems)} icon={ClipboardList} />
    </div>
  );
}
