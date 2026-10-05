'use client';

import { CalendarIcon } from 'lucide-react';
import { de } from 'react-day-picker/locale';

import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { useFieldContext } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDatePickerSegments } from '@/components/ui/use-date-picker-segments';

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  // Lets a form Label point at the picker (htmlFor/id) and gives the group a
  // field-specific accessible name instead of the generic "Datum".
  id?: string;
  ariaLabel?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Datum wählen',
  disabled = false,
  id,
  ariaLabel,
}: DatePickerProps) {
  const field = useFieldContext();
  const {
    open,
    setOpen,
    containerRef,
    activeSegment,
    isFocused,
    inputBuffer,
    day,
    month,
    year,
    handleSegmentClick,
    handleFocus,
    handleBlur,
    handleKeyDown,
    handleCalendarSelect,
  } = useDatePickerSegments(value, onChange, disabled);

  const pad = (n: number | undefined, len: number) =>
    n !== undefined ? String(n).padStart(len, '0') : '–'.repeat(len);

  const segmentBaseClass = 'px-1 py-0.5 rounded-sm cursor-pointer transition-colors select-none tabular-nums';
  const segmentActiveClass = 'bg-primary text-primary-foreground';
  const segmentInactiveClass = 'hover:bg-accent';

  const hasValue = value !== undefined;
  const displayDay = hasValue ? pad(day, 2) : '––';
  const displayMonth = hasValue ? pad(month, 2) : '––';
  const displayYear =
    activeSegment === 'year' && inputBuffer ? inputBuffer.padEnd(4, '–') : hasValue ? pad(year, 4) : '––––';

  return (
    <div
      ref={containerRef}
      id={id ?? field?.controlId}
      role="group"
      aria-label={ariaLabel ?? (field ? undefined : 'Datum')}
      aria-labelledby={ariaLabel ? undefined : field?.labelId}
      aria-describedby={
        [field?.describedBy, field?.requiredDescriptionId].filter(Boolean).join(' ') || undefined
      }
      aria-disabled={disabled || undefined}
      data-invalid={field?.invalid || undefined}
      tabIndex={disabled ? -1 : 0}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex h-9 w-full items-center gap-0.5 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
        'border-input dark:bg-input/30',
        isFocused && 'border-ring ring-ring/50 ring-2',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Kalender öffnen"
            tabIndex={-1}
            disabled={disabled}
            className="mr-1.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            <CalendarIcon className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={handleCalendarSelect} locale={de} />
        </PopoverContent>
      </Popover>

      {!hasValue && !isFocused ? (
        <span className="text-muted-foreground select-none">{placeholder}</span>
      ) : (
        <>
          <span
            onClick={() => handleSegmentClick('day')}
            className={cn(
              segmentBaseClass,
              activeSegment === 'day' ? segmentActiveClass : segmentInactiveClass,
            )}
          >
            {displayDay}
          </span>
          <span className="text-muted-foreground select-none">.</span>
          <span
            onClick={() => handleSegmentClick('month')}
            className={cn(
              segmentBaseClass,
              activeSegment === 'month' ? segmentActiveClass : segmentInactiveClass,
            )}
          >
            {displayMonth}
          </span>
          <span className="text-muted-foreground select-none">.</span>
          <span
            onClick={() => handleSegmentClick('year')}
            className={cn(
              segmentBaseClass,
              activeSegment === 'year' ? segmentActiveClass : segmentInactiveClass,
            )}
          >
            {displayYear}
          </span>
        </>
      )}
    </div>
  );
}
