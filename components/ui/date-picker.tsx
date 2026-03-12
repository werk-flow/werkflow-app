'use client';

import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { de } from 'react-day-picker/locale';

import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

type Segment = 'day' | 'month' | 'year';

const SEGMENT_ORDER: Segment[] = ['day', 'month', 'year'];

const MAX_VALUES: Record<Segment, number> = {
  day: 31,
  month: 12,
  year: 9999,
};

const SEGMENT_LENGTHS: Record<Segment, number> = {
  day: 2,
  month: 2,
  year: 4,
};

export function DatePicker({
  value,
  onChange,
  placeholder = 'Datum wählen',
  disabled = false
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [activeSegment, setActiveSegment] = React.useState<Segment | null>(null);
  const [isFocused, setIsFocused] = React.useState(false);
  const [inputBuffer, setInputBuffer] = React.useState('');
  const bufferTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const day = value ? value.getDate() : undefined;
  const month = value ? value.getMonth() + 1 : undefined;
  const year = value ? value.getFullYear() : undefined;

  const pad = (n: number | undefined, len: number) =>
    n !== undefined ? String(n).padStart(len, '0') : '–'.repeat(len);

  const buildDate = (d: number, m: number, y: number): Date | undefined => {
    if (d < 1 || m < 1 || y < 1) return undefined;
    const maxDay = new Date(y, m, 0).getDate();
    const clampedDay = Math.min(d, maxDay);
    return new Date(y, m - 1, clampedDay);
  };

  const clearBuffer = () => {
    setInputBuffer('');
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
  };

  const resetBufferTimer = () => {
    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = setTimeout(clearBuffer, 1000);
  };

  const applySegmentValue = (segment: Segment, val: number) => {
    const curDay = day ?? 1;
    const curMonth = month ?? 1;
    const curYear = year ?? new Date().getFullYear();

    let newDay = curDay;
    let newMonth = curMonth;
    let newYear = curYear;

    if (segment === 'day') newDay = val;
    else if (segment === 'month') newMonth = val;
    else newYear = val;

    const result = buildDate(newDay, newMonth, newYear);
    onChange(result);
  };

  const handleSegmentClick = (segment: Segment) => {
    if (disabled) return;
    setActiveSegment(segment);
    setIsFocused(true);
    clearBuffer();
  };

  const handleFocus = () => {
    if (disabled) return;
    setIsFocused(true);
    if (!activeSegment) setActiveSegment('day');
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    setIsFocused(false);
    setActiveSegment(null);
    clearBuffer();
  };

  const advanceSegment = () => {
    const idx = activeSegment ? SEGMENT_ORDER.indexOf(activeSegment) : -1;
    if (idx < SEGMENT_ORDER.length - 1) {
      setActiveSegment(SEGMENT_ORDER[idx + 1]);
    }
    clearBuffer();
  };

  const retreatSegment = () => {
    const idx = activeSegment ? SEGMENT_ORDER.indexOf(activeSegment) : -1;
    if (idx > 0) {
      setActiveSegment(SEGMENT_ORDER[idx - 1]);
    }
    clearBuffer();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || !activeSegment) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      const curDay = day ?? 1;
      const curMonth = month ?? 1;
      const curYear = year ?? new Date().getFullYear();

      if (activeSegment === 'day') {
        const maxDay = new Date(curYear, curMonth, 0).getDate();
        const newDay = ((curDay - 1 + delta + maxDay) % maxDay) + 1;
        applySegmentValue('day', newDay);
      } else if (activeSegment === 'month') {
        const newMonth = ((curMonth - 1 + delta + 12) % 12) + 1;
        applySegmentValue('month', newMonth);
      } else {
        applySegmentValue('year', Math.max(1, curYear + delta));
      }
      clearBuffer();
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      retreatSegment();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      advanceSegment();
      return;
    }

    if (e.key === 'Tab') {
      if (!e.shiftKey && activeSegment !== 'year') {
        e.preventDefault();
        advanceSegment();
        return;
      }
      if (e.shiftKey && activeSegment !== 'day') {
        e.preventDefault();
        retreatSegment();
        return;
      }
      setActiveSegment(null);
      clearBuffer();
      return;
    }

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const digit = e.key;
      const newBuffer = inputBuffer + digit;
      const maxLen = SEGMENT_LENGTHS[activeSegment];
      const maxVal = MAX_VALUES[activeSegment];

      const numericVal = parseInt(newBuffer, 10);

      if (newBuffer.length >= maxLen) {
        const clamped = Math.min(numericVal, maxVal);
        if (clamped > 0) applySegmentValue(activeSegment, clamped);
        advanceSegment();
        return;
      }

      if (activeSegment === 'day' && numericVal > 3) {
        const clamped = Math.min(numericVal, maxVal);
        if (clamped > 0) applySegmentValue(activeSegment, clamped);
        advanceSegment();
        return;
      }

      if (activeSegment === 'month' && numericVal > 1) {
        const clamped = Math.min(numericVal, maxVal);
        if (clamped > 0) applySegmentValue(activeSegment, clamped);
        advanceSegment();
        return;
      }

      setInputBuffer(newBuffer);
      resetBufferTimer();
      if (numericVal > 0) applySegmentValue(activeSegment, numericVal);
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (inputBuffer.length > 0) {
        clearBuffer();
        return;
      }
      const curDay = day ?? 1;
      const curMonth = month ?? 1;
      const curYear = year ?? new Date().getFullYear();

      if (activeSegment === 'day') onChange(buildDate(1, curMonth, curYear));
      else if (activeSegment === 'month') onChange(buildDate(curDay, 1, curYear));
      else onChange(buildDate(curDay, curMonth, new Date().getFullYear()));
      return;
    }
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    onChange(date);
    setOpen(false);
  };

  const segmentBaseClass =
    'px-1 py-0.5 rounded-sm cursor-pointer transition-colors select-none tabular-nums';
  const segmentActiveClass = 'bg-primary text-primary-foreground';
  const segmentInactiveClass = 'hover:bg-accent';

  const hasValue = value !== undefined;
  const displayDay = hasValue ? pad(day, 2) : '––';
  const displayMonth = hasValue ? pad(month, 2) : '––';
  const displayYear = hasValue ? pad(year, 4) : '––––';

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Datum"
      tabIndex={disabled ? -1 : 0}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex h-9 w-full items-center gap-0.5 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
        'border-input dark:bg-input/30',
        isFocused && 'border-ring ring-ring/50 ring-[3px]',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50'
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
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
          <Calendar
            mode="single"
            selected={value}
            onSelect={handleCalendarSelect}
            locale={de}
          />
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
              activeSegment === 'day' ? segmentActiveClass : segmentInactiveClass
            )}
          >
            {displayDay}
          </span>
          <span className="text-muted-foreground select-none">.</span>
          <span
            onClick={() => handleSegmentClick('month')}
            className={cn(
              segmentBaseClass,
              activeSegment === 'month' ? segmentActiveClass : segmentInactiveClass
            )}
          >
            {displayMonth}
          </span>
          <span className="text-muted-foreground select-none">.</span>
          <span
            onClick={() => handleSegmentClick('year')}
            className={cn(
              segmentBaseClass,
              activeSegment === 'year' ? segmentActiveClass : segmentInactiveClass
            )}
          >
            {displayYear}
          </span>
        </>
      )}
    </div>
  );
}
