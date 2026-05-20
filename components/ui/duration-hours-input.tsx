'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';

interface DurationHoursInputProps
  extends Omit<
    React.ComponentProps<'input'>,
    'onChange' | 'value' | 'type' | 'defaultValue'
  > {
  value: string;
  onChange: (value: string) => void;
}

function sanitizeHoursInput(value: string) {
  const normalized = value.replace(',', '.');
  let result = '';
  let hasDot = false;

  for (const char of normalized) {
    if (char >= '0' && char <= '9') {
      result += char;
      continue;
    }

    if (char === '.' && !hasDot) {
      result += char;
      hasDot = true;
    }
  }

  return result;
}

export const DurationHoursInput = React.forwardRef<
  HTMLInputElement,
  DurationHoursInputProps
>(function DurationHoursInput(
  { className, value, onChange, disabled, onBlur, onKeyDown, ...props },
  ref
) {
  const adjustByMinutes = (deltaMinutes: number) => {
    const currentMinutes = parseHoursInputToMinutes(value) ?? 0;
    const nextMinutes = Math.max(0, currentMinutes + deltaMinutes);
    onChange(nextMinutes === 0 ? '' : formatMinutesAsHoursInput(nextMinutes));
  };

  return (
    <div
      className={cn(
        'flex h-9 w-full items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        'dark:bg-input/30',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(sanitizeHoursInput(e.target.value))}
        onBlur={(e) => {
          onChange(formatMinutesAsHoursInput(parseHoursInputToMinutes(e.target.value)));
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (!disabled && e.key === 'ArrowUp') {
            e.preventDefault();
            adjustByMinutes(30);
            return;
          }

          if (!disabled && e.key === 'ArrowDown') {
            e.preventDefault();
            adjustByMinutes(-30);
            return;
          }

          onKeyDown?.(e);
        }}
        disabled={disabled}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />

      <span className="border-l px-2 text-xs font-medium text-muted-foreground">
        Std.
      </span>

      <div className="flex h-full shrink-0 border-l">
        <button
          type="button"
          onClick={() => adjustByMinutes(-30)}
          disabled={disabled}
          aria-label="Dauer um 30 Minuten verringern"
          className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => adjustByMinutes(30)}
          disabled={disabled}
          aria-label="Dauer um 30 Minuten erhöhen"
          className="flex h-full w-8 items-center justify-center border-l text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
});
