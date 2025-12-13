'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface TimeInputProps
  extends Omit<
    React.ComponentProps<'div'>,
    'onChange' | 'defaultValue' | 'value'
  > {
  value: string; // Format: "HH:MM"
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

type Segment = 'hours' | 'minutes';

/**
 * Custom time input that always displays 24-hour format (HH:MM)
 * regardless of browser or system locale settings.
 *
 * Uses visual segment highlighting instead of native text selection
 * for consistent cross-browser behavior (especially Safari).
 */
const TimeInput = React.forwardRef<HTMLDivElement, TimeInputProps>(
  ({ className, value, onChange, disabled, id, ...props }, ref) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [activeSegment, setActiveSegment] = React.useState<Segment | null>(
      null
    );
    const [isFocused, setIsFocused] = React.useState(false);

    // Combine refs
    React.useImperativeHandle(ref, () => containerRef.current!);

    // Parse value into hours and minutes
    const parseValue = (val: string): { hours: number; minutes: number } => {
      if (!val || !/^\d{2}:\d{2}$/.test(val)) {
        return { hours: 0, minutes: 0 };
      }
      const [h, m] = val.split(':').map(Number);
      return { hours: h, minutes: m };
    };

    const { hours, minutes } = parseValue(value);

    // Format a number to 2 digits
    const pad = (n: number) => String(n).padStart(2, '0');

    // Update value
    const updateValue = (newHours: number, newMinutes: number) => {
      onChange(`${pad(newHours)}:${pad(newMinutes)}`);
    };

    // Handle segment click
    const handleSegmentClick = (segment: Segment) => {
      if (disabled) return;
      setActiveSegment(segment);
      setIsFocused(true);
    };

    // Handle container focus
    const handleFocus = () => {
      if (disabled) return;
      setIsFocused(true);
      if (!activeSegment) {
        setActiveSegment('hours');
      }
    };

    // Handle container blur
    const handleBlur = (e: React.FocusEvent) => {
      // Check if focus is moving to a child element
      if (containerRef.current?.contains(e.relatedTarget as Node)) {
        return;
      }
      setIsFocused(false);
      setActiveSegment(null);
    };

    // Handle keyboard input
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled || !activeSegment) return;

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

      // Tab - move between segments or to next field
      if (e.key === 'Tab') {
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
        return;
      }

      // Number keys - input digits
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const digit = parseInt(e.key, 10);

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
        return;
      }
    };

    const segmentBaseClass =
      'px-1.5 py-1 rounded-sm cursor-pointer transition-colors select-none';
    const segmentActiveClass = 'bg-primary text-primary-foreground';
    const segmentInactiveClass = 'hover:bg-accent';

    return (
      <div
        ref={containerRef}
        role="group"
        aria-label="Uhrzeit"
        tabIndex={disabled ? -1 : 0}
        id={id}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          'inline-flex h-9 w-full items-center gap-0.5 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
          'border-input dark:bg-input/30',
          isFocused && 'border-ring ring-ring/50 ring-[3px]',
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
          className
        )}
        {...props}
      >
        {/* Hours segment */}
        <span
          onClick={() => handleSegmentClick('hours')}
          className={cn(
            segmentBaseClass,
            activeSegment === 'hours'
              ? segmentActiveClass
              : segmentInactiveClass
          )}
        >
          {pad(hours)}
        </span>

        {/* Separator */}
        <span className="text-muted-foreground select-none">:</span>

        {/* Minutes segment */}
        <span
          onClick={() => handleSegmentClick('minutes')}
          className={cn(
            segmentBaseClass,
            activeSegment === 'minutes'
              ? segmentActiveClass
              : segmentInactiveClass
          )}
        >
          {pad(minutes)}
        </span>
      </div>
    );
  }
);

TimeInput.displayName = 'TimeInput';

export { TimeInput };

