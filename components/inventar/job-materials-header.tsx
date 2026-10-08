'use client';

import { ClipboardList, PackagePlus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { cn } from '@/lib/utils';
import { SectionTitle } from '@/components/shared/section-title';
import { Spinner } from '@/components/ui/spinner';

/** The section heading with the plan and take commands. */
export function JobMaterialsHeader({
  isUpdating,
  isProjectContext,
  totalCount,
  isAdminOrManager,
  readOnly,
  isPickerLoading,
  inventoryItemCount,
  onPlan,
  onTake,
}: {
  /** A saved change is still settling and no single line carries the indicator. */
  isUpdating: boolean;
  isProjectContext: boolean;
  totalCount: number;
  isAdminOrManager: boolean;
  readOnly: boolean;
  isPickerLoading: boolean;
  inventoryItemCount: number;
  onPlan: () => void;
  onTake: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <SectionTitle icon={<ClipboardList className="size-4" />}>
          Material &amp; Inventar
          <InlinePending active={isUpdating} label="Material wird aktualisiert" />
        </SectionTitle>
        {isProjectContext && totalCount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {totalCount} zusammengefasste Artikel aus Projekt und Aufträgen
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdminOrManager && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={onPlan}
            disabled={inventoryItemCount === 0}
          >
            <Plus className="size-3.5" />
            Material planen
          </Button>
        )}
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1 text-xs', isAdminOrManager ? 'h-8' : 'min-h-11')}
            onClick={onTake}
            aria-busy={isPickerLoading}
            disabled={isPickerLoading || (isAdminOrManager && inventoryItemCount === 0)}
          >
            {isPickerLoading ? (
              <Spinner className="size-3.5" />
            ) : (
              <PackagePlus className="size-3.5" aria-hidden="true" />
            )}
            {isPickerLoading ? 'Material wird geladen…' : 'Aus Lager entnehmen'}
          </Button>
        )}
      </div>
    </div>
  );
}
