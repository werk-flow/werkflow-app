import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The regions the design canon lets scroll sideways (werkflow-design,
 * "Density and layout"): the calendar surfaces, a tab strip, an area nav and a
 * table from the tablet breakpoint. Each owner sets
 * the marker itself, so a page cannot gain an unapproved sideways scroller by
 * accident: the layout audit fails on any element that scrolls sideways
 * without it, and lint rejects scroll classes and the marker outside the
 * registry.
 */
export type ScrollRegionName = 'calendar' | 'tab-strip' | 'area-nav' | 'table';

/** The marker attribute of a named scroll region, for a registry element that scrolls itself. */
export function scrollRegion(name: ScrollRegionName): { 'data-scroll-region': ScrollRegionName } {
  return { 'data-scroll-region': name };
}

type ScrollRegionProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'role' | 'tabIndex'> & {
  name: ScrollRegionName;
  /** Both axes for a surface (the calendar), the horizontal axis otherwise. */
  axes?: 'both' | 'x';
  /**
   * A region without focusable content of its own takes focus, so a keyboard
   * user can scroll it (WCAG 2.1.1, axe `scrollable-region-focusable`); it then
   * needs a German name.
   */
  focusable?: { label: string };
};

/** A named scroll region: the one way product code gets a region that scrolls sideways. */
export const ScrollRegion = React.forwardRef<HTMLDivElement, ScrollRegionProps>(
  ({ name, axes = 'x', focusable, className, ...props }, ref) => (
    <div
      ref={ref}
      {...scrollRegion(name)}
      {...(focusable ? { role: 'region', tabIndex: 0, 'aria-label': focusable.label } : {})}
      className={cn(
        axes === 'both' ? 'overflow-auto' : 'overflow-x-auto',
        focusable && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  ),
);
ScrollRegion.displayName = 'ScrollRegion';
