"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { de } from "react-day-picker/locale";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

type Segment = "day" | "month" | "year";

interface DateSegments {
  day: number;
  month: number;
  year: number;
}

const SEGMENT_ORDER: Segment[] = ["day", "month", "year"];

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
  placeholder = "Datum wählen",
  disabled = false,
  id,
  ariaLabel = "Datum",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [activeSegment, setActiveSegment] = React.useState<Segment | null>(
    null,
  );
  const [isFocused, setIsFocused] = React.useState(false);
  const [inputBuffer, setInputBuffer] = React.useState("");
  const bufferTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const valueRef = React.useRef(value);
  const draftSegmentsRef = React.useRef<DateSegments>({
    day: value?.getDate() ?? 1,
    month: value ? value.getMonth() + 1 : 1,
    year: value?.getFullYear() ?? new Date().getFullYear(),
  });
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const day = value ? value.getDate() : undefined;
  const month = value ? value.getMonth() + 1 : undefined;
  const year = value ? value.getFullYear() : undefined;

  const pad = (n: number | undefined, len: number) =>
    n !== undefined ? String(n).padStart(len, "0") : "–".repeat(len);

  const buildDate = (d: number, m: number, y: number): Date | undefined => {
    if (d < 1 || m < 1 || y < 1) return undefined;
    const endOfMonth = new Date(0);
    endOfMonth.setFullYear(y, m, 0);
    const maxDay = endOfMonth.getDate();
    const clampedDay = Math.min(d, maxDay);
    const result = new Date(0);
    result.setFullYear(y, m - 1, clampedDay);
    result.setHours(0, 0, 0, 0);
    return result;
  };

  const clearBuffer = () => {
    setInputBuffer("");
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
  };

  const resetBufferTimer = (onExpire?: () => void) => {
    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = setTimeout(() => {
      bufferTimerRef.current = null;
      onExpire?.();
      setInputBuffer("");
    }, 1000);
  };

  const applySegmentValue = (segment: Segment, val: number) => {
    const nextSegments = { ...draftSegmentsRef.current, [segment]: val };
    draftSegmentsRef.current = nextSegments;
    const result = buildDate(
      nextSegments.day,
      nextSegments.month,
      nextSegments.year,
    );
    valueRef.current = result;
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
    const currentValue = valueRef.current;
    draftSegmentsRef.current = {
      day: currentValue?.getDate() ?? 1,
      month: currentValue ? currentValue.getMonth() + 1 : 1,
      year: currentValue?.getFullYear() ?? new Date().getFullYear(),
    };
    setIsFocused(true);
    if (!activeSegment) setActiveSegment("day");
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    if (open) return;
    if (activeSegment === "year" && inputBuffer) {
      const bufferedYear = Number(inputBuffer);
      if (bufferedYear > 0) applySegmentValue("year", bufferedYear);
    }
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

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? 1 : -1;
      const curDay = day ?? 1;
      const curMonth = month ?? 1;
      const curYear = year ?? new Date().getFullYear();

      if (activeSegment === "day") {
        const maxDay = new Date(curYear, curMonth, 0).getDate();
        const newDay = ((curDay - 1 + delta + maxDay) % maxDay) + 1;
        applySegmentValue("day", newDay);
      } else if (activeSegment === "month") {
        const newMonth = ((curMonth - 1 + delta + 12) % 12) + 1;
        applySegmentValue("month", newMonth);
      } else {
        applySegmentValue("year", Math.max(1, curYear + delta));
      }
      clearBuffer();
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      retreatSegment();
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      advanceSegment();
      return;
    }

    if (e.key === "Tab") {
      if (!e.shiftKey && activeSegment !== "year") {
        e.preventDefault();
        advanceSegment();
        return;
      }
      if (e.shiftKey && activeSegment !== "day") {
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

      if (activeSegment === "day" && numericVal > 3) {
        const clamped = Math.min(numericVal, maxVal);
        if (clamped > 0) applySegmentValue(activeSegment, clamped);
        advanceSegment();
        return;
      }

      if (activeSegment === "month" && numericVal > 1) {
        const clamped = Math.min(numericVal, maxVal);
        if (clamped > 0) applySegmentValue(activeSegment, clamped);
        advanceSegment();
        return;
      }

      setInputBuffer(newBuffer);
      resetBufferTimer(
        activeSegment === "year"
          ? () => applySegmentValue("year", numericVal)
          : undefined,
      );
      if (activeSegment === "year") return;
      if (numericVal > 0) applySegmentValue(activeSegment, numericVal);
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (inputBuffer.length > 0) {
        clearBuffer();
        return;
      }
      if (activeSegment === "day") applySegmentValue("day", 1);
      else if (activeSegment === "month") applySegmentValue("month", 1);
      else applySegmentValue("year", new Date().getFullYear());
      return;
    }
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    valueRef.current = date;
    if (date) {
      draftSegmentsRef.current = {
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      };
    }
    onChange(date);
    setOpen(false);
    containerRef.current?.focus();
  };

  const segmentBaseClass =
    "px-1 py-0.5 rounded-sm cursor-pointer transition-colors select-none tabular-nums";
  const segmentActiveClass = "bg-primary text-primary-foreground";
  const segmentInactiveClass = "hover:bg-accent";

  const hasValue = value !== undefined;
  const displayDay = hasValue ? pad(day, 2) : "––";
  const displayMonth = hasValue ? pad(month, 2) : "––";
  const displayYear =
    activeSegment === "year" && inputBuffer
      ? inputBuffer.padEnd(4, "–")
      : hasValue
        ? pad(year, 4)
        : "––––";

  return (
    <div
      ref={containerRef}
      id={id}
      role="group"
      aria-label={ariaLabel}
      tabIndex={disabled ? -1 : 0}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex h-9 w-full items-center gap-0.5 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm",
        "border-input dark:bg-input/30",
        isFocused && "border-ring ring-ring/50 ring-2",
        disabled && "pointer-events-none cursor-not-allowed opacity-50",
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
            onClick={() => handleSegmentClick("day")}
            className={cn(
              segmentBaseClass,
              activeSegment === "day"
                ? segmentActiveClass
                : segmentInactiveClass,
            )}
          >
            {displayDay}
          </span>
          <span className="text-muted-foreground select-none">.</span>
          <span
            onClick={() => handleSegmentClick("month")}
            className={cn(
              segmentBaseClass,
              activeSegment === "month"
                ? segmentActiveClass
                : segmentInactiveClass,
            )}
          >
            {displayMonth}
          </span>
          <span className="text-muted-foreground select-none">.</span>
          <span
            onClick={() => handleSegmentClick("year")}
            className={cn(
              segmentBaseClass,
              activeSegment === "year"
                ? segmentActiveClass
                : segmentInactiveClass,
            )}
          >
            {displayYear}
          </span>
        </>
      )}
    </div>
  );
}
