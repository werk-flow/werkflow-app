'use client';

import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/time-input';
import type { MetadataField } from '@/components/shared/metadata-section';

export type MetadataFieldConfig = NonNullable<MetadataField['editableConfig']>;

export interface MetadataFieldEditorProps {
  editValue: string;
  hasChanges: boolean;
  isPending: boolean;
  onEditValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function MetadataTimeControl({
  editValue,
  hasChanges,
  isPending,
  onEditValueChange,
  onSave,
  onCancel,
}: MetadataFieldEditorProps) {
  return (
    <TimeInput
      value={editValue}
      onChange={onEditValueChange}
      disabled={isPending}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && hasChanges) {
          e.preventDefault();
          onSave();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/** Clear, save and cancel of a field in edit mode. */
export function MetadataFieldActions({
  supportsInlineActions,
  canClear,
  editValue,
  hasChanges,
  isPending,
  onEditValueChange,
  onSave,
  onCancel,
}: {
  supportsInlineActions: boolean;
  canClear: boolean | undefined;
} & MetadataFieldEditorProps) {
  const clearDisabled = !editValue.trim() || isPending;
  return (
    <div
      className={
        supportsInlineActions
          ? 'flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5'
          : 'flex flex-wrap items-center justify-end gap-2'
      }
    >
      {canClear && (
        <Button
          type="button"
          variant="ghost"
          className="gap-1.5"
          onClick={() => onEditValueChange('')}
          // eslint-disable-next-line ui/action-disabled-only-while-pending -- nothing to clear: the field is already empty
          disabled={clearDisabled}
        >
          <RotateCcw className="size-3.5" />
          Leeren
        </Button>
      )}
      <Button
        pending={isPending}
        type="button"
        variant="default"
        onClick={onSave}
        disabled={isPending || !hasChanges}
      >
        Speichern
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
        Abbrechen
      </Button>
    </div>
  );
}
