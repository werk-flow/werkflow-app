import { Loader2, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The one running-action indicator (werkflow-design skill, "Loading states").
 * `data-slot="spinner"` is the busy signal the browser settle step waits on
 * (lib/testing/spec-support/busy-signals.ts), so no test reads an animation
 * class. Without `label` the icon is decorative and the surrounding control
 * carries the state (`Button pending` sets `aria-busy`); with `label` it
 * announces itself as a status.
 */
export function Spinner({
  icon: Icon = Loader2,
  label,
  className,
}: {
  icon?: LucideIcon;
  /** German status text for assistive tech when nothing around the spinner names the state. */
  label?: string;
  className?: string | undefined;
}) {
  const classes = cn('size-4 animate-spin', className);
  if (!label) return <Icon data-slot="spinner" aria-hidden="true" className={classes} />;
  return <Icon data-slot="spinner" role="status" aria-label={label} className={classes} />;
}
