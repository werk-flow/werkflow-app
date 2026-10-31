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

function stepDateSegment(delta: 1 | -1, activeSegment: Segment, context: DateSegmentKeyContext): void {
  const { day, month, year, applySegmentValue } = context;
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
}

function handleDateSegmentTab(
  e: React.KeyboardEvent,
  activeSegment: Segment,
  context: DateSegmentKeyContext,
): void {
  const { advanceSegment, retreatSegment, clearBuffer } = context;
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
}

function typeDateSegmentDigit(digit: string, activeSegment: Segment, context: DateSegmentKeyContext): void {
  const { inputBuffer, applySegmentValue, advanceSegment } = context;
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
}

function handleDateSegmentKeyDown(e: React.KeyboardEvent, context: DateSegmentKeyContext): void {
  const { disabled, activeSegment, inputBuffer } = context;
  const { applySegmentValue, advanceSegment, retreatSegment, clearBuffer } = context;
  if (disabled || !activeSegment) return;

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    stepDateSegment(e.key === 'ArrowUp' ? 1 : -1, activeSegment, context);
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
    handleDateSegmentTab(e, activeSegment, context);
    return;
  }

  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    typeDateSegmentDigit(e.key, activeSegment, context);
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

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

/** The draft segments a picker starts from: the value's, else the 1st of January this year. */
function draftSegmentsFor(date: Date | undefined): DateSegments {
  return {
    day: date?.getDate() ?? 1,
    month: date ? date.getMonth() + 1 : 1,
    year: date?.getFullYear() ?? new Date().getFullYear(),
  };
}

/** Hook-named so it may take the timer ref; it calls no React hook. */
function useDateSegmentBuffer(
  setInputBuffer: SetState<string>,
  bufferTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>,
) {
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

  return { clearBuffer, resetBufferTimer };
}

function createDateSegmentNavigation(
  activeSegment: Segment | null,
  setActiveSegment: (segment: Segment | null) => void,
  clearBuffer: () => void,
) {
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

  return { advanceSegment, retreatSegment };
}

interface DateSegmentFocusContext {
  disabled: boolean;
  open: boolean;
  activeSegment: Segment | null;
  inputBuffer: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  valueRef: React.RefObject<Date | undefined>;
  draftSegmentsRef: React.RefObject<DateSegments>;
  setActiveSegment: SetState<Segment | null>;
  setIsFocused: SetState<boolean>;
  clearBuffer: () => void;
  applySegmentValue: (segment: Segment, val: number) => void;
}

/** Hook-named so it may take the refs; it calls no React hook. */
function useDateSegmentFocusHandlers(context: DateSegmentFocusContext) {
  const { disabled, open, activeSegment, inputBuffer, containerRef, valueRef, draftSegmentsRef } = context;
  const { setActiveSegment, setIsFocused, clearBuffer, applySegmentValue } = context;

  const handleSegmentClick = (segment: Segment) => {
    if (disabled) return;
    setActiveSegment(segment);
    setIsFocused(true);
    clearBuffer();
  };

  const handleFocus = () => {
    if (disabled) return;
    draftSegmentsRef.current = draftSegmentsFor(valueRef.current);
    setIsFocused(true);
    if (!activeSegment) setActiveSegment('day');
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (e.relatedTarget instanceof Node && containerRef.current?.contains(e.relatedTarget)) return;
    if (open) return;
    if (activeSegment === 'year' && inputBuffer) {
      const bufferedYear = Number(inputBuffer);
      if (bufferedYear > 0) applySegmentValue('year', bufferedYear);
    }
    setIsFocused(false);
    setActiveSegment(null);
    clearBuffer();
  };

  return { handleSegmentClick, handleFocus, handleBlur };
}

function createDateSegmentKeyDown(context: Omit<DateSegmentKeyContext, 'advanceSegment' | 'retreatSegment'>) {
  const { advanceSegment, retreatSegment } = createDateSegmentNavigation(
    context.activeSegment,
    context.setActiveSegment,
    context.clearBuffer,
  );

  return (e: React.KeyboardEvent) =>
    handleDateSegmentKeyDown(e, { ...context, advanceSegment, retreatSegment });
}

/** Hook-named so it may take the refs; it calls no React hook. */
function useDateSegmentDraftWrites({
  draftSegmentsRef,
  valueRef,
  containerRef,
  onChange,
  setOpen,
}: {
  draftSegmentsRef: React.RefObject<DateSegments>;
  valueRef: React.RefObject<Date | undefined>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (date: Date | undefined) => void;
  setOpen: SetState<boolean>;
}) {
  const applySegmentValue = (segment: Segment, val: number) => {
    const nextSegments = { ...draftSegmentsRef.current, [segment]: val };
    draftSegmentsRef.current = nextSegments;
    const result = buildDateFromSegments(nextSegments.day, nextSegments.month, nextSegments.year);
    valueRef.current = result;
    onChange(result);
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    valueRef.current = date;
    if (date) {
      draftSegmentsRef.current = draftSegmentsFor(date);
    }
    onChange(date);
    setOpen(false);
    containerRef.current?.focus();
  };

  return { applySegmentValue, handleCalendarSelect };
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
  const draftSegmentsRef = React.useRef<DateSegments>(draftSegmentsFor(value));
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

  const { clearBuffer, resetBufferTimer } = useDateSegmentBuffer(setInputBuffer, bufferTimerRef);

  const { applySegmentValue, handleCalendarSelect } = useDateSegmentDraftWrites({
    draftSegmentsRef,
    valueRef,
    containerRef,
    onChange,
    setOpen,
  });

  const { handleSegmentClick, handleFocus, handleBlur } = useDateSegmentFocusHandlers({
    disabled,
    open,
    activeSegment,
    inputBuffer,
    containerRef,
    valueRef,
    draftSegmentsRef,
    setActiveSegment,
    setIsFocused,
    clearBuffer,
    applySegmentValue,
  });

  const handleKeyDown = createDateSegmentKeyDown({
    disabled,
    activeSegment,
    day,
    month,
    year,
    inputBuffer,
    applySegmentValue,
    clearBuffer,
    setActiveSegment,
    setInputBuffer,
    resetBufferTimer,
  });

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
