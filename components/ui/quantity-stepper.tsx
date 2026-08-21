'use client';

import { Minus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatDecimalDe, parseDecimalInput } from '@/lib/ui/decimal';

/**
 * Numeric quantity entry with large ± targets (44px, field-worker friendly)
 * and de-DE decimal handling. `min` may be negative (e.g. dispatch day
 * shifts); stepping never crosses it, typed input is clamped on step.
 */
type QuantityStepperProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  unitLabel?: string;
  min?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
};

export function QuantityStepper({
  id,
  value,
  onChange,
  unitLabel,
  min = 0,
  step = 1,
  disabled = false,
  className,
}: QuantityStepperProps) {
  const numericValue = parseDecimalInput(value);

  function update(nextValue: number) {
    onChange(
      formatDecimalDe(Math.max(min, Math.round(nextValue * 100) / 100))
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          disabled={disabled || numericValue <= min}
          onClick={() => update(numericValue - step)}
        >
          <Minus className="size-4" />
          <span className="sr-only">Menge verringern</span>
        </Button>
        <div className="relative">
          <Input
            id={id}
            inputMode="decimal"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="h-11 px-4 text-center text-xl font-semibold tabular-nums"
          />
          {unitLabel && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {unitLabel}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          disabled={disabled}
          onClick={() => update(numericValue + step)}
        >
          <Plus className="size-4" />
          <span className="sr-only">Menge erhöhen</span>
        </Button>
      </div>
    </div>
  );
}
