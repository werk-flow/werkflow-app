import type * as React from 'react';

export const TIME_SEGMENTS = ['hours', 'minutes'] as const;
export type TimeSegment = (typeof TIME_SEGMENTS)[number];

interface TimeSegmentKeyContext {
  activeSegment: TimeSegment;
  hours: number;
  minutes: number;
  updateValue: (newHours: number, newMinutes: number) => void;
  setActiveSegment: (segment: TimeSegment | null) => void;
}

/** Splits an `HH:MM` value into hours and minutes; anything else reads as 00:00. */
export function parseTimeInputValue(val: string): { hours: number; minutes: number } {
  if (!val || !/^\d{2}:\d{2}$/.test(val)) {
    return { hours: 0, minutes: 0 };
  }
  const [h, m] = val.split(':').map(Number);
  if (h === undefined || m === undefined) {
    return { hours: 0, minutes: 0 };
  }
  return { hours: h, minutes: m };
}

/** Formats a number to 2 digits. */
export function padTimeSegment(n: number): string {
  return String(n).padStart(2, '0');
}

// Tab - move between segments or to next field
function handleTimeSegmentTab(e: React.KeyboardEvent<HTMLDivElement>, context: TimeSegmentKeyContext): void {
  const { activeSegment, setActiveSegment } = context;
  if (!e.shiftKey && activeSegment === 'hours') {
    e.preventDefault();
    setActiveSegment('minutes');
    return;
  }
  if (e.shiftKey && activeSegment === 'minutes') {
    e.preventDefault();
    setActiveSegment('hours');
    return;
  }
  // Let default tab behavior proceed to move to next/prev field
  setActiveSegment(null);
}

// Number keys - input digits
function typeTimeSegmentDigit(digit: number, context: TimeSegmentKeyContext): void {
  const { activeSegment, hours, minutes, updateValue, setActiveSegment } = context;
  if (activeSegment === 'hours') {
    // Build 2-digit hours
    let newHours: number;
    if (hours < 3) {
      // Can potentially add second digit
      const combined = hours * 10 + digit;
      newHours = combined <= 23 ? combined : digit;
    } else {
      // Start fresh
      newHours = digit;
    }
    updateValue(newHours, minutes);

    // Auto-advance to minutes if we have a complete hour
    if (newHours >= 3 || (hours >= 1 && hours * 10 + digit <= 23)) {
      setActiveSegment('minutes');
    }
  } else {
    // Build 2-digit minutes
    let newMinutes: number;
    if (minutes < 6) {
      // Can potentially add second digit
      const combined = minutes * 10 + digit;
      newMinutes = combined <= 59 ? combined : digit;
    } else {
      // Start fresh
      newMinutes = digit;
    }
    updateValue(hours, newMinutes);
  }
}

/** Arrow, Tab, digit and delete keys of the active `TimeInput` segment. */
export function handleTimeSegmentKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
  context: TimeSegmentKeyContext,
): void {
  const { activeSegment, hours, minutes, updateValue, setActiveSegment } = context;

  // Arrow up/down - increment/decrement
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? 1 : -1;

    if (activeSegment === 'hours') {
      const newHours = (hours + delta + 24) % 24;
      updateValue(newHours, minutes);
    } else {
      const newMinutes = (minutes + delta + 60) % 60;
      updateValue(hours, newMinutes);
    }
    return;
  }

  // Arrow left/right - move between segments
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    setActiveSegment(e.key === 'ArrowLeft' ? 'hours' : 'minutes');
    return;
  }

  if (e.key === 'Tab') {
    handleTimeSegmentTab(e, context);
    return;
  }

  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    typeTimeSegmentDigit(parseInt(e.key, 10), context);
    return;
  }

  // Backspace/Delete - reset segment to 00
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (activeSegment === 'hours') {
      updateValue(0, minutes);
    } else {
      updateValue(hours, 0);
    }
  }
}
