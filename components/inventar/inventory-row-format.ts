import type { InventoryItemType, InventoryOverview, InventoryOverviewItem } from '@/lib/inventory/types';

export function formatMovementTarget(movement: InventoryOverview['movements'][number]): {
  from: string;
  to: string;
} {
  const jobLabel = movement.jobNumber
    ? `Auftrag ${movement.jobNumber}`
    : movement.jobTitle
      ? `Auftrag ${movement.jobTitle}`
      : 'Auftrag';
  const projectLabel = movement.projectNumber
    ? `Projekt ${movement.projectNumber}`
    : movement.projectName
      ? `Projekt ${movement.projectName}`
      : 'Projekt';
  const targetLabel = movement.jobId
    ? movement.projectId
      ? `${jobLabel} · ${projectLabel}`
      : jobLabel
    : movement.projectId
      ? projectLabel
      : null;

  switch (movement.movementType) {
    case 'job_take':
      return {
        from: movement.locationName,
        to: targetLabel ?? 'Auftrag/Projekt',
      };
    case 'job_return':
      return {
        from: targetLabel ?? 'Auftrag/Projekt',
        to: movement.locationName,
      };
    case 'stock_in':
    case 'initial_count':
      return { from: 'Externe Quelle', to: movement.locationName };
    case 'stock_out':
      return { from: movement.locationName, to: 'Korrektur/Ausgang' };
    case 'transfer_in':
      return { from: 'Umlagerung', to: movement.locationName };
    case 'transfer_out':
      return { from: movement.locationName, to: 'Umlagerung' };
    default:
      return { from: movement.locationName, to: 'Korrektur' };
  }
}

export function stockStatusClasses(status: InventoryOverviewItem['stockStatus']): string {
  switch (status) {
    case 'out_of_stock':
      return 'border-destructive/40 bg-destructive-soft text-destructive-soft-foreground';
    case 'low_stock':
      return 'border-warning/40 bg-warning-soft text-warning-soft-foreground';
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
