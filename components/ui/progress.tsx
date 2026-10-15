'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

interface ProgressProps extends Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'aria-label'> {
  /**
   * What the bar measures, in German („Tagesfortschritt: 80 %“): a progress
   * bar without a name tells a screen reader a number without its meaning
   * (axe `aria-progressbar-name`), so the name is required.
   */
  label: string;
  indicatorClassName?: string;
}

function Progress({ className, indicatorClassName, value, label, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      aria-label={label}
      value={value}
      className={cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('bg-primary h-full w-full flex-1 transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
