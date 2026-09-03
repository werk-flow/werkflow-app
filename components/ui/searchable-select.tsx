'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search, Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { filterByQuery } from '@/lib/ui/search';
import { useFieldContext } from '@/components/ui/field';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SearchableSelectBaseProps {
  options: SearchableSelectOption[];
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /**
   * Accessible name for the trigger. Without it the trigger is announced by
   * its visible value/placeholder — set it when several identical selects
   * render on one page (e.g. one per card) or a Label cannot target the id.
   */
  ariaLabel?: string;
  action?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
  /** Replaces the default label/description block of each option row. */
  renderOption?: (
    option: SearchableSelectOption,
    isSelected: boolean
  ) => React.ReactNode;
}

function filterOptions(
  options: SearchableSelectOption[],
  search: string
): SearchableSelectOption[] {
  return filterByQuery(options, search, (option) =>
    option.description ? `${option.label} ${option.description}` : option.label
  );
}

function handleListWheel(e: React.WheelEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0) {
    // Keep wheel interaction local even when no internal scroll range exists.
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const atTop = scrollTop <= 0 && e.deltaY < 0;
  const atBottom = scrollTop >= maxScroll - 1 && e.deltaY > 0;

  if (atTop || atBottom) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  el.scrollTop = Math.max(0, Math.min(maxScroll, scrollTop + e.deltaY));
}

/*
 * DROPDOWN PORTALING INVARIANT (regression fixed 2026-08-23):
 * The popover MUST portal to document.body (Radix's default portal) and be
 * sized/flipped by Radix collision handling against the VIEWPORT.
 * Never portal it into the surrounding dialog: DialogContent clips overflow,
 * so inside a short dialog the expanded list gets cut off and becomes
 * unusable (this happened with a hand-rolled `closest('[role="dialog"]')`
 * portal container plus viewport-based height math — the math saw viewport
 * space the dialog's clip rect didn't have). Popover-in-Dialog with body
 * portals is the stock Radix/shadcn combination; the layer stack keeps
 * clicks inside the popover from counting as outside the dialog.
 * The list's max height comes from --radix-popover-content-available-height,
 * capped at 320px, so it always fits the viewport on either side.
 */

interface SearchableSelectProps extends SearchableSelectBaseProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  readOnly?: boolean;
  readOnlyLabel?: string;
}

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = 'Auswählen...',
  searchPlaceholder = 'Suchen...',
  emptyMessage = 'Keine Ergebnisse',
  disabled = false,
  ariaLabel,
  allowNone = false,
  noneLabel = 'Keine Auswahl',
  action,
  renderOption,
  onSearchChange,
  readOnly = false,
  readOnlyLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const listboxId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const field = useFieldContext();
  const resolvedId = id ?? field?.controlId;

  React.useEffect(() => {
    if (open) {
      setSearch('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = React.useMemo(
    () => filterOptions(options, search),
    [options, search]
  );

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = readOnlyLabel ?? selectedOption?.label ?? (value ? value : placeholder);

  if (readOnly) {
    return (
      <div
        id={id}
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 py-1 text-base md:text-sm',
          'cursor-default select-none text-muted-foreground'
        )}
      >
        <span className="truncate">{displayLabel}</span>
      </div>
    );
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) onSearchChange?.('');
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          id={resolvedId}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-describedby={field?.describedBy}
          aria-invalid={field?.invalid || undefined}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            'flex h-9 w-full min-w-0 max-w-full items-center justify-between overflow-hidden rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
            'dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2',
            disabled && 'pointer-events-none cursor-not-allowed opacity-50',
            !selectedOption && !value && 'text-muted-foreground'
          )}
        >
          <span className="min-w-0 max-w-full flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
            {displayLabel}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>

      {/* Body portal + viewport collision handling — see the invariant comment above. */}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          className={cn(
            'z-[120] flex max-h-[min(320px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] flex-col rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2'
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="border-b px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  onSearchChange?.(e.target.value);
                }}
                className="h-8 w-full rounded-md border bg-muted/50 pl-8 pr-3 text-sm placeholder:text-muted-foreground/70 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    onSearchChange?.('');
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          <div
            id={listboxId}
            role="listbox"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            onWheelCapture={handleListWheel}
          >
            {action && (
              <button
                type="button"
                onClick={() => {
                  action.onClick();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-primary hover:bg-accent transition-colors"
              >
                {action.icon}
                {action.label}
              </button>
            )}

            {allowNone && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  !value ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                )}
              >
                <div
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    !value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30'
                  )}
                >
                  {!value && <Check className="size-2.5" />}
                </div>
                <span className="text-muted-foreground">{noneLabel}</span>
              </button>
            )}

            {filtered.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                  )}
                >
                  <div
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {isSelected && <Check className="size-2.5" />}
                  </div>
                  {renderOption ? (
                    renderOption(option, isSelected)
                  ) : (
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="font-medium truncate">{option.label}</p>
                      {option.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {option.description}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

interface SearchableMultiSelectProps extends SearchableSelectBaseProps {
  /** Trigger id, so a `Field` label can target it; defaults to the `Field` context id. */
  id?: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  placeholder?: string;
  selectedLabel?: (count: number) => string;
  /** Adds a row that clears the whole selection. */
  allowNone?: boolean;
  noneLabel?: string;
  readOnly?: boolean;
  readOnlyLabel?: string;
}

export function SearchableMultiSelect({
  id,
  options,
  selectedIds,
  onSelectionChange,
  placeholder = 'Auswählen...',
  selectedLabel,
  searchPlaceholder = 'Suchen...',
  emptyMessage = 'Keine Ergebnisse',
  disabled = false,
  ariaLabel,
  action,
  renderOption,
  allowNone = false,
  noneLabel = 'Auswahl leeren',
  readOnly = false,
  readOnlyLabel,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const field = useFieldContext();
  const resolvedId = id ?? field?.controlId;
  const listboxId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (open) {
      setSearch('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = React.useMemo(
    () => filterOptions(options, search),
    [options, search]
  );

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
      <div
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 py-1 text-base md:text-sm',
          'cursor-default select-none text-muted-foreground'
        )}
      >
        <span className="truncate">{readOnlyLabel ?? label}</span>
      </div>
    );
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          id={resolvedId}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-describedby={field?.describedBy}
          aria-invalid={field?.invalid || undefined}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            'flex h-9 w-full min-w-0 max-w-full items-center justify-between overflow-hidden rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
            'dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2',
            disabled && 'pointer-events-none cursor-not-allowed opacity-50',
            selectedIds.length === 0 && 'text-muted-foreground'
          )}
        >
          <span className="min-w-0 max-w-full flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
            {label}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>

      {/* Body portal + viewport collision handling — see the invariant comment above. */}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          className={cn(
            'z-[120] flex max-h-[min(320px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] flex-col rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2'
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="border-b px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-md border bg-muted/50 pl-8 pr-3 text-sm placeholder:text-muted-foreground/70 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          <div
            id={listboxId}
            role="listbox"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            onWheelCapture={handleListWheel}
          >
            {action && (
              <button
                type="button"
                onClick={() => {
                  action.onClick();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-primary hover:bg-accent transition-colors"
              >
                {action.icon}
                {action.label}
              </button>
            )}

            {allowNone && (
              <button
                type="button"
                onClick={() => onSelectionChange([])}
                disabled={selectedIds.length === 0}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  selectedIds.length === 0
                    ? 'cursor-default opacity-50'
                    : 'hover:bg-accent'
                )}
              >
                <div className="flex size-4 shrink-0 items-center justify-center rounded-sm border-2 border-muted-foreground/30" />
                <span className="text-muted-foreground">{noneLabel}</span>
              </button>
            )}

            {filtered.map((option) => {
              const isSelected = selectedIds.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggle(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left transition-colors',
                    isSelected ? 'bg-primary/10' : 'hover:bg-accent'
                  )}
                >
                  <div
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-sm border-2 transition-colors',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {isSelected && <Check className="size-2.5" />}
                  </div>
                  {renderOption ? (
                    renderOption(option, isSelected)
                  ) : (
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="font-medium truncate">{option.label}</p>
                      {option.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {option.description}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
