'use client';

import * as React from 'react';
import { clickedSegment } from '@/components/ui/clicked-segment';
import { useFieldContext } from '@/components/ui/field';
import {
  TIME_SEGMENTS,
  handleTimeSegmentKeyDown,
  padTimeSegment,
  parseTimeInputValue,
  type TimeSegment,
} from '@/components/ui/time-input-keys';
import { cn } from '@/lib/utils';

interface TimeInputProps extends Omit<React.ComponentProps<'div'>, 'onChange' | 'defaultValue' | 'value'> {
  value: string; // Format: "HH:MM"
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

type Segment = TimeSegment;

function EmptySegmentLine() {
  return <span aria-hidden className="inline-block h-px w-4 rounded-full bg-muted-foreground align-middle" />;
}

const segmentBaseClass = 'px-1.5 py-1 rounded-sm cursor-pointer transition-colors select-none';
const segmentActiveClass = 'bg-primary text-primary-foreground';
const segmentInactiveClass = 'hover:bg-accent';

function TimeInputSegment({
  segment,
  activeSegment,
  hasValue,
  amount,
}: {
  segment: Segment;
  activeSegment: Segment | null;
  hasValue: boolean;
  amount: number;
}) {
  return (
    <span
      data-segment={segment}
      className={cn(segmentBaseClass, activeSegment === segment ? segmentActiveClass : segmentInactiveClass)}
    >
      {!hasValue && activeSegment !== segment ? <EmptySegmentLine /> : padTimeSegment(amount)}
    </span>
  );
}

function TimeInputSegments({
  activeSegment,
  hasValue,
  hours,
  minutes,
}: {
  activeSegment: Segment | null;
  hasValue: boolean;
  hours: number;
  minutes: number;
}) {
  return (
    <>
      {/* Hours segment */}
      <TimeInputSegment segment="hours" activeSegment={activeSegment} hasValue={hasValue} amount={hours} />

      {/* Separator */}
      <span className="text-muted-foreground select-none">:</span>

      {/* Minutes segment */}
      <TimeInputSegment
        segment="minutes"
        activeSegment={activeSegment}
        hasValue={hasValue}
        amount={minutes}
      />
    </>
  );
}

function timeInputClassName(
  isFocused: boolean,
  disabled: boolean | undefined,
  className: string | undefined,
) {
  return cn(
    'inline-flex h-9 w-full items-center gap-0.5 rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow] outline-none md:text-sm',
    'border-input dark:bg-input/30',
    isFocused && 'ring-ring/50 ring-2',
    disabled && 'pointer-events-none cursor-not-allowed opacity-50',
    className,
  );
}

/** The group's name, description and invalid state: the caller's own, else the enclosing `Field`'s. */
function timeInputGroupAria(
  field: ReturnType<typeof useFieldContext>,
  {
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
    ariaInvalid,
  }: {
    ariaLabel: string | undefined;
    ariaLabelledBy: string | undefined;
    ariaDescribedBy: string | undefined;
    ariaInvalid: TimeInputProps['aria-invalid'];
  },
) {
  return {
    'aria-label': ariaLabel ?? (field ? undefined : 'Uhrzeit'),
    'aria-labelledby': ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId),
    'aria-describedby':
      ariaDescribedBy ??
      ([field?.describedBy, field?.requiredDescriptionId].filter(Boolean).join(' ') || undefined),
    'data-invalid': ariaInvalid ?? (field?.invalid || undefined),
  };
}

/** Focus and active segment of a `TimeInput`. */
function useTimeSegmentFocus(disabled: boolean | undefined) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [activeSegment, setActiveSegment] = React.useState<Segment | null>(null);
  const [isFocused, setIsFocused] = React.useState(false);

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
    if (e.relatedTarget instanceof Node && containerRef.current?.contains(e.relatedTarget)) {
      return;
    }
    setIsFocused(false);
    setActiveSegment(null);
  };

  return {
    containerRef,
    activeSegment,
    setActiveSegment,
    isFocused,
    handleSegmentClick,
    handleFocus,
    handleBlur,
  };
}

/**
 * Custom time input that always displays 24-hour format (HH:MM)
 * regardless of browser or system locale settings.
 *
 * Uses visual segment highlighting instead of native text selection
 * for consistent cross-browser behavior (especially Safari).
 */
const TimeInput = React.forwardRef<HTMLDivElement, TimeInputProps>(
  (
    {
      className,
      value,
      onChange,
      disabled,
      id: idProp,
      onBlur,
      onFocus,
      onKeyDown,
      onClick,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const field = useFieldContext();
    const id = idProp ?? field?.controlId;
    const {
      containerRef,
      activeSegment,
      setActiveSegment,
      isFocused,
      handleSegmentClick,
      handleFocus,
      handleBlur,
    } = useTimeSegmentFocus(disabled);
    // Combine refs
    React.useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(ref, () => containerRef.current);

    const { hours, minutes } = parseTimeInputValue(value);
    const hasValue = !!value && /^\d{2}:\d{2}$/.test(value);

    // Update value
    const updateValue = (newHours: number, newMinutes: number) => {
      onChange(`${padTimeSegment(newHours)}:${padTimeSegment(newMinutes)}`);
    };

    // Handle keyboard input
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (disabled || !activeSegment) return;
      handleTimeSegmentKeyDown(e, { activeSegment, hours, minutes, updateValue, setActiveSegment });
    };

    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- one tab stop like a native time field: the group owns the arrow and digit keys of its segments, and a click picks the segment the arrow keys reach
      <div
        ref={containerRef}
        role="group"
        {...timeInputGroupAria(field, { ariaLabel, ariaLabelledBy, ariaDescribedBy, ariaInvalid })}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        id={id}
        onFocus={(e) => {
          handleFocus();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          handleBlur(e);
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          const segment = clickedSegment(event.target, TIME_SEGMENTS);
          if (segment) handleSegmentClick(segment);
          onClick?.(event);
        }}
        className={timeInputClassName(isFocused, disabled, className)}
        {...props}
      >
        <TimeInputSegments
          activeSegment={activeSegment}
          hasValue={hasValue}
          hours={hours}
          minutes={minutes}
        />
      </div>
    );
  },
);

TimeInput.displayName = 'TimeInput';

export { TimeInput };
