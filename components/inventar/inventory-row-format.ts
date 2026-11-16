import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import type {
  InventoryItemType,
  InventoryMovementHistoryEntry,
  InventoryOverviewItem,
} from '@/lib/inventory/types';
import { INVENTORY_STOCK_UNCHANGED_LABEL } from '@/lib/inventory/types';

/** One end of a movement: a place, or the job or project it links to. */
export type MovementEnd = { label: string; href: string | null };

const place = (label: string): MovementEnd => ({ label, href: null });

/** The job or project a movement or use names, linked to its page; null when it names neither. */
function movementWork(entry: InventoryMovementHistoryEntry): MovementEnd | null {
  const project = entry.projectId ? { id: entry.projectId, projectNumber: entry.projectNumber } : null;
  const projectLabel = `Projekt ${entry.projectNumber ?? entry.projectName ?? ''}`.trim();
  if (entry.jobId) {
    const jobLabel = `Auftrag ${entry.jobNumber ?? entry.jobTitle ?? ''}`.trim();
    return {
      label: project ? `${jobLabel} · ${projectLabel}` : jobLabel,
      href: jobDetailHref({ id: entry.jobId, jobNumber: entry.jobNumber }, project),
    };
  }
  return project ? { label: projectLabel, href: projectDetailHref(project) } : null;
}

/**
 * Where a movement came from and went to („Von“ and „Nach“); a stock movement
 * names its Lager on one side. A use and its correction have no place: they
 * come from the job and leave the stock as it is.
 */
export function formatMovementTarget(entry: InventoryMovementHistoryEntry): {
  from: MovementEnd;
  to: MovementEnd;
} {
  const work = movementWork(entry) ?? place('Auftrag/Projekt');
  const location = place(entry.locationName ?? 'Unbekanntes Lager');

  switch (entry.kind) {
    case 'job_take':
      return { from: location, to: work };
    case 'job_return':
      return { from: work, to: location };
    case 'job_use':
    case 'job_use_correction':
      return { from: work, to: place(INVENTORY_STOCK_UNCHANGED_LABEL) };
    case 'stock_in':
    case 'initial_count':
      return { from: place('Externe Quelle'), to: location };
    case 'stock_out':
      return { from: location, to: place('Korrektur/Ausgang') };
    case 'transfer_in':
      return { from: place('Umlagerung'), to: location };
    case 'transfer_out':
      return { from: location, to: place('Umlagerung') };
    case 'correction':
      return { from: location, to: place('Korrektur') };
  }
}

/** A use and its correction move no stock: they have no Lager and no quantity before or after. */
export function movesStock(entry: InventoryMovementHistoryEntry): boolean {
  return entry.kind !== 'job_use' && entry.kind !== 'job_use_correction';
}

/** Low stock, and an article whose unit is outside the unit list („Einheit prüfen“). */
export const WARNING_BADGE_CLASSES = 'border-warning/40 bg-warning-soft text-warning-soft-foreground';

export function stockStatusClasses(status: InventoryOverviewItem['stockStatus']): string {
  switch (status) {
    case 'shortfall':
    case 'out_of_stock':
      return 'border-destructive/40 bg-destructive-soft text-destructive-soft-foreground';
    case 'low_stock':
      return WARNING_BADGE_CLASSES;
    case 'in_stock':
      return 'border-success/40 bg-success-soft text-success-soft-foreground';
  }
}

export function itemTypeClasses(type: InventoryItemType): string {
  switch (type) {
    case 'material':
      return 'bg-muted text-muted-foreground';
    case 'consumable':
      return 'bg-muted text-muted-foreground';
    case 'tool':
      return 'bg-muted text-muted-foreground';
    case 'asset':
      return 'bg-muted text-muted-foreground';
  }
}
