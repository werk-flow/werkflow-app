'use client';

import * as React from 'react';
import { buildDateFromSegments } from '@/lib/ui/date-segments';

type Segment = 'day' | 'month' | 'year';

interface DateSegments {
  day: number;
  month: number;
  year: number;
}

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

interface DateSegmentKeyContext {
  disabled: boolean;
  activeSegment: Segment | null;
  day: number | undefined;
  month: number | undefined;
  year: number | undefined;
  inputBuffer: string;
  applySegmentValue: (segment: Segment, val: number) => void;
  advanceSegment: () => void;
  retreatSegment: () => void;
  clearBuffer: () => void;
  setActiveSegment: (segment: Segment | null) => void;
  setInputBuffer: (buffer: string) => void;
  resetBufferTimer: (onExpire?: () => void) => void;
}

function handleDateSegmentKeyDown(e: React.KeyboardEvent, context: DateSegmentKeyContext): void {
  const { disabled, activeSegment, day, month, year, inputBuffer } = context;
  const { applySegmentValue, advanceSegment, retreatSegment, clearBuffer } = context;
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
    context.setActiveSegment(null);
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

    context.setInputBuffer(newBuffer);
    context.resetBufferTimer(
      activeSegment === 'year' ? () => applySegmentValue('year', numericVal) : undefined,
    );
    if (activeSegment === 'year') return;
    if (numericVal > 0) applySegmentValue(activeSegment, numericVal);
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (inputBuffer.length > 0) {
      clearBuffer();
      return;
    }
    if (activeSegment === 'day') applySegmentValue('day', 1);
    else if (activeSegment === 'month') applySegmentValue('month', 1);
    else applySegmentValue('year', new Date().getFullYear());
    return;
  }
}

/** Segment focus, typed-digit buffer and calendar popover state of the `DatePicker`. */
export function useDatePickerSegments(
  value: Date | undefined,
  onChange: (date: Date | undefined) => void,
  disabled: boolean,
) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [activeSegment, setActiveSegment] = React.useState<Segment | null>(null);
  const [isFocused, setIsFocused] = React.useState(false);
  const [inputBuffer, setInputBuffer] = React.useState('');
  const bufferTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = React.useRef(value);
  const draftSegmentsRef = React.useRef<DateSegments>({
    day: value?.getDate() ?? 1,
    month: value ? value.getMonth() + 1 : 1,
    year: value?.getFullYear() ?? new Date().getFullYear(),
  });
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);
  // A pending year commit must not reach `onChange` after the picker unmounts.
  React.useEffect(
    () => () => {
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    },
    [],
  );

  const day = value ? value.getDate() : undefined;
  const month = value ? value.getMonth() + 1 : undefined;
  const year = value ? value.getFullYear() : undefined;

  const clearBuffer = () => {
    setInputBuffer('');
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
      setInputBuffer('');
    }, 1000);
  };

  const applySegmentValue = (segment: Segment, val: number) => {
    const nextSegments = { ...draftSegmentsRef.current, [segment]: val };
    draftSegmentsRef.current = nextSegments;
    const result = buildDateFromSegments(nextSegments.day, nextSegments.month, nextSegments.year);
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
    if (!activeSegment) setActiveSegment('day');
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    if (open) return;
    if (activeSegment === 'year' && inputBuffer) {
      const bufferedYear = Number(inputBuffer);
      if (bufferedYear > 0) applySegmentValue('year', bufferedYear);
    }
    setIsFocused(false);
    setActiveSegment(null);
    clearBuffer();
  };

  const advanceSegment = () => {
    const idx = activeSegment ? SEGMENT_ORDER.indexOf(activeSegment) : -1;
    const nextSegment = SEGMENT_ORDER[idx + 1];
    if (nextSegment !== undefined) {
      setActiveSegment(nextSegment);
    }
    clearBuffer();
  };

  const retreatSegment = () => {
    const idx = activeSegment ? SEGMENT_ORDER.indexOf(activeSegment) : -1;
    const previousSegment = idx > 0 ? SEGMENT_ORDER[idx - 1] : undefined;
    if (previousSegment !== undefined) {
      setActiveSegment(previousSegment);
    }
    clearBuffer();
  };

  const handleKeyDown = (e: React.KeyboardEvent) =>
    handleDateSegmentKeyDown(e, {
      disabled,
      activeSegment,
      day,
      month,
      year,
      inputBuffer,
      applySegmentValue,
      advanceSegment,
      retreatSegment,
      clearBuffer,
      setActiveSegment,
      setInputBuffer,
      resetBufferTimer,
    });

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

  return {
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
  };
}
