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

interface SearchableSelectProps extends SearchableSelectBaseProps {
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  allowNone?: boolean | undefined;
  noneLabel?: string | undefined;
  readOnly?: boolean | undefined;
  readOnlyLabel?: string | undefined;
}

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = 'Auswählen…',
  searchPlaceholder = 'Suchen…',
  emptyMessage = 'Keine Ergebnisse',
  disabled = false,
  ariaLabel,
  allowNone = false,
  noneLabel = 'Keine Auswahl',
  action,
  renderOption,
  onSearchChange,
  loading = false,
  loadError,
  onRetryLoad,
  onLoadMore,
  readOnly = false,
  readOnlyLabel,
}: SearchableSelectProps) {
  const popup = useSearchableSelectPopup(options, onSearchChange);
  const field = useFieldContext();
  const resolvedId = id ?? field?.controlId;
  const { setOpen } = popup;

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = readOnlyLabel ?? selectedOption?.label ?? (value ? value : placeholder);

  if (readOnly) {
    return (
      <SearchableSelectReadOnly id={resolvedId} ariaLabel={ariaLabel} field={field} label={displayLabel} />
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
        muted={!selectedOption && !value}
        label={displayLabel}
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
      >
        {allowNone && (
          <button
            type="button"
            role="option"
            aria-selected={!value}
            tabIndex={-1}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              !value ? 'bg-primary/10 text-primary-text' : 'hover:bg-accent',
            )}
          >
            <div
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                !value ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30',
              )}
            >
              {!value && <Check className="size-2.5" />}
            </div>
            <span className="text-muted-foreground">{noneLabel}</span>
          </button>
        )}

        {popup.filtered.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left transition-colors focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isSelected ? 'bg-primary/10 text-primary-text' : 'hover:bg-accent',
              )}
            >
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
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
