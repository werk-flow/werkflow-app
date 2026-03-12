'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search, Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SearchableSelectBaseProps {
  options: SearchableSelectOption[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  action?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
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

function useDialogPortalContainer(
  triggerRef: React.RefObject<HTMLElement | null>,
  open: boolean
) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const dialogEl = trigger.closest('[role="dialog"]') as HTMLElement | null;
    setContainer(dialogEl);
  }, [open, triggerRef]);

  return container;
}

type DropdownSide = 'top' | 'bottom';

function useDialogAwareDropdownLayout(
  triggerRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  optionCount: number
) {
  const [side, setSide] = React.useState<DropdownSide>('bottom');
  const [maxHeight, setMaxHeight] = React.useState(240);

  React.useEffect(() => {
    if (!open) return;

    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const dialog = trigger.closest('[role="dialog"]') as HTMLElement | null;
      const bounds = dialog?.getBoundingClientRect() ?? {
        top: 8,
        bottom: window.innerHeight - 8
      };

      const spaceBelow = bounds.bottom - triggerRect.bottom - 8;
      const spaceAbove = triggerRect.top - bounds.top - 8;
      const estimatedContent = Math.min(
        280,
        Math.max(120, 52 + optionCount * 34)
      );

      const preferredSide: DropdownSide =
        spaceBelow >= estimatedContent || spaceBelow >= spaceAbove
          ? 'bottom'
          : 'top';
      const available = preferredSide === 'bottom' ? spaceBelow : spaceAbove;

      setSide(preferredSide);
      setMaxHeight(Math.max(120, Math.min(280, Math.floor(available - 52))));
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, optionCount, triggerRef]);

  return { side, maxHeight };
}

interface SearchableSelectProps extends SearchableSelectBaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  readOnly?: boolean;
  readOnlyLabel?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Auswählen...',
  searchPlaceholder = 'Suchen...',
  emptyMessage = 'Keine Ergebnisse',
  disabled = false,
  allowNone = false,
  noneLabel = 'Keine Auswahl',
  action,
  readOnly = false,
  readOnlyLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const portalContainer = useDialogPortalContainer(triggerRef, open);

  React.useEffect(() => {
    if (open) {
      setSearch('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [options, search]);
  const { side, maxHeight } = useDialogAwareDropdownLayout(
    triggerRef,
    open,
    filtered.length + (allowNone ? 1 : 0) + (action ? 1 : 0)
  );

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = readOnlyLabel ?? selectedOption?.label ?? (value ? value : placeholder);

  if (readOnly) {
    return (
      <div
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
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between overflow-hidden rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
            'dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            disabled && 'pointer-events-none cursor-not-allowed opacity-50',
            !selectedOption && !value && 'text-muted-foreground'
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
        <PopoverPrimitive.Content
          side={side}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          className={cn(
            'z-[120] w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none',
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
            className="overflow-y-auto overscroll-contain p-1"
            style={{ maxHeight }}
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
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p className="font-medium truncate">{option.label}</p>
                    {option.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {option.description}
                      </p>
                    )}
                  </div>
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
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  placeholder?: string;
  selectedLabel?: (count: number) => string;
}

export function SearchableMultiSelect({
  options,
  selectedIds,
  onSelectionChange,
  placeholder = 'Auswählen...',
  selectedLabel,
  searchPlaceholder = 'Suchen...',
  emptyMessage = 'Keine Ergebnisse',
  disabled = false
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const portalContainer = useDialogPortalContainer(triggerRef, open);

  React.useEffect(() => {
    if (open) {
      setSearch('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [options, search]);
  const { side, maxHeight } = useDialogAwareDropdownLayout(
    triggerRef,
    open,
    filtered.length
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

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between overflow-hidden rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
            'dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            disabled && 'pointer-events-none cursor-not-allowed opacity-50',
            selectedIds.length === 0 && 'text-muted-foreground'
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
        <PopoverPrimitive.Content
          side={side}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          className={cn(
            'z-[120] w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none',
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
            className="overflow-y-auto overscroll-contain p-1"
            style={{ maxHeight }}
            onWheelCapture={handleListWheel}
          >
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
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p className="font-medium truncate">{option.label}</p>
                    {option.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {option.description}
                      </p>
                    )}
                  </div>
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
