'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFieldContext } from '@/components/ui/field';
import {
  SearchableOptionLabel,
  SearchableSelectPopup,
  SearchableSelectReadOnly,
  SearchableSelectTrigger,
  type SearchableSelectBaseProps,
} from '@/components/ui/searchable-select-popup';
import { useSearchableSelectPopup } from '@/components/ui/use-searchable-select-popup';

interface SearchableMultiSelectProps extends SearchableSelectBaseProps {
  /** Trigger id, so a `Field` label can target it; defaults to the `Field` context id. */
  id?: string | undefined;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  placeholder?: string | undefined;
  selectedLabel?: ((count: number) => string) | undefined;
  /** Adds a row that clears the whole selection. */
  allowNone?: boolean | undefined;
  noneLabel?: string | undefined;
  readOnly?: boolean | undefined;
  readOnlyLabel?: string | undefined;
}

export function SearchableMultiSelect({
  id,
  options,
  selectedIds,
  onSelectionChange,
  placeholder = 'Auswählen…',
  selectedLabel,
  searchPlaceholder = 'Suchen…',
  emptyMessage = 'Keine Ergebnisse',
  disabled = false,
  ariaLabel,
  action,
  renderOption,
  onSearchChange,
  loading = false,
  loadError,
  onRetryLoad,
  onLoadMore,
  allowNone = false,
  noneLabel = 'Auswahl leeren',
  readOnly = false,
  readOnlyLabel,
}: SearchableMultiSelectProps) {
  const field = useFieldContext();
  const resolvedId = id ?? field?.controlId;
  const popup = useSearchableSelectPopup(options, onSearchChange);

  const toggle = (val: string) => {
    if (selectedIds.includes(val)) {
      onSelectionChange(selectedIds.filter((id) => id !== val));
    } else {
      onSelectionChange([...selectedIds, val]);
    }
  };

  const label =
    selectedIds.length === 0
      ? placeholder
      : selectedLabel
        ? selectedLabel(selectedIds.length)
        : `${selectedIds.length} ausgewählt`;

  if (readOnly) {
    return (
      <SearchableSelectReadOnly
        id={resolvedId}
        ariaLabel={ariaLabel}
        field={field}
        label={readOnlyLabel ?? label}
      />
    );
  }

  return (
    <PopoverPrimitive.Root open={popup.open} onOpenChange={popup.changeOpen}>
      <SearchableSelectTrigger
        id={resolvedId}
        triggerRef={popup.triggerRef}
        open={popup.open}
        listboxId={popup.listboxId}
        onOpenRequest={() => popup.changeOpen(true)}
        ariaLabel={ariaLabel}
        field={field}
        disabled={disabled}
        muted={selectedIds.length === 0}
        label={label}
      />

      <SearchableSelectPopup
        state={popup}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        ariaLabel={ariaLabel}
        field={field}
        action={action}
        loading={loading}
        loadError={loadError}
        onRetryLoad={onRetryLoad}
        onLoadMore={onLoadMore}
        multiselectable
        beforeList={
          allowNone && (
            <button
              type="button"
              onClick={() => onSelectionChange([])}
              disabled={selectedIds.length === 0}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                selectedIds.length === 0 ? 'cursor-default opacity-50' : 'hover:bg-accent',
              )}
            >
              <div className="flex size-4 shrink-0 items-center justify-center rounded-sm border-2 border-muted-foreground/30" />
              <span className="text-muted-foreground">{noneLabel}</span>
            </button>
          )
        }
      >
        {popup.filtered.map((option) => {
          const isSelected = selectedIds.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              onClick={() => toggle(option.value)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left transition-colors focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isSelected ? 'bg-primary/10' : 'hover:bg-accent',
              )}
            >
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-sm border-2 transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30',
                )}
              >
                {isSelected && <Check className="size-2.5" />}
              </div>
              {renderOption ? renderOption(option, isSelected) : <SearchableOptionLabel option={option} />}
            </button>
          );
        })}
      </SearchableSelectPopup>
    </PopoverPrimitive.Root>
  );
}
