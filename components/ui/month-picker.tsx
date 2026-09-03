'use client';

import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { useFieldContext } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Month entry (`YYYY-MM`) without the browser's native month control, which
// looks different in every browser and is banned by the registry lint. The
// visible field accepts typing ("09.2026" or "2026-09") and a popover offers a
// twelve-month grid per year. `name` renders a hidden input with the
// normalized value so server-action forms read it like before.

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
] as const;

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

function parseMonth(input: string): string | null {
  const trimmed = input.trim();
  const iso = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
  const german = /^(\d{1,2})[./](\d{4})$/.exec(trimmed);
  const [year, month] = iso
    ? [Number(iso[1]), Number(iso[2])]
    : german
      ? [Number(german[2]), Number(german[1])]
      : [NaN, NaN];
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatMonth(value: string): string {
  const parsed = /^(\d{4})-(\d{2})$/.exec(value);
  if (!parsed) return '';
  return `${parsed[2]}.${parsed[1]}`;
}

export function MonthPicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
  ariaLabel,
}: {
  id?: string;
  /** Renders a hidden input with the normalized `YYYY-MM` for forms. */
  name?: string;
  /** Controlled `YYYY-MM`. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const field = useFieldContext();
  const generatedId = useId();
  const controlId = id ?? field?.controlId ?? generatedId;
  const [internal, setInternal] = useState(defaultValue ?? '');
  const current = value ?? internal;
  const [text, setText] = useState(formatMonth(current));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [gridYear, setGridYear] = useState(() => Number(current.slice(0, 4)) || new Date().getFullYear());

  // While typing, the field shows the raw text so a half-typed "2026-1" is
  // never rewritten to "01.2026"; otherwise it mirrors the committed value.
  const displayText = editing ? text : formatMonth(current);

  function commit(next: string) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }

  function handleBlur() {
    const parsed = parseMonth(text);
    if (parsed) {
      commit(parsed);
      setText(formatMonth(parsed));
      setGridYear(Number(parsed.slice(0, 4)));
    } else if (text.trim() === '') {
      commit('');
    } else {
      setText(formatMonth(current));
    }
  }

  const selectedYear = Number(current.slice(0, 4));
  const selectedMonth = Number(current.slice(5, 7));

  return (
    <div className={cn('relative flex items-center', className)}>
      {name && <input type="hidden" name={name} value={current} />}
      <input
        id={controlId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM.JJJJ"
        value={displayText}
        disabled={disabled}
        required={required ?? field?.required}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        onChange={(event) => {
          setText(event.target.value);
          // Commit a complete value at once (four-digit year and two-digit
          // month), so a form submitted right after typing never reads a
          // stale hidden value; partial input waits for blur.
          if (/^(\d{4}-\d{2}|\d{2}[./]\d{4})$/.test(event.target.value.trim())) {
            const parsed = parseMonth(event.target.value);
            if (parsed) commit(parsed);
          }
        }}
        onFocus={() => {
          setText(formatMonth(current));
          setEditing(true);
        }}
        onBlur={() => {
          handleBlur();
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') handleBlur();
        }}
        className={cn(
          'border-input dark:bg-input/30 placeholder:text-muted-foreground h-9 w-full min-w-0 rounded-md border bg-transparent py-1 pr-9 pl-3 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2',
          'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
        )}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Auswahl öffnen"
            className="absolute right-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            <CalendarIcon className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Vorheriges Jahr"
              onClick={() => setGridYear((year) => year - 1)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-medium tabular-nums">{gridYear}</span>
            <button
              type="button"
              aria-label="Nächstes Jahr"
              onClick={() => setGridYear((year) => year + 1)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, index) => {
              const month = index + 1;
              const isSelected = gridYear === selectedYear && month === selectedMonth;
              return (
                <button
                  key={label}
                  type="button"
                  aria-label={`${MONTH_NAMES[index]} ${gridYear}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    commit(`${gridYear}-${String(month).padStart(2, '0')}`);
                    setOpen(false);
                  }}
                  className={cn(
                    'h-9 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
