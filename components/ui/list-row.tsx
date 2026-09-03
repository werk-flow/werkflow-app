import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The mobile card row: what a table row becomes below the tablet breakpoint.
 * One class string for loaded rows and their skeletons, so hover fidelity
 * cannot drift (design canon: a skeleton mirrors the hover of what it loads,
 * never more, never less). `interactive` is the only way to get hover.
 */
export const LIST_ROW_BASE_CLASS =
  'flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5';
/** A row inside a divided container (a card's `divide-y` list): no box of its own. */
export const LIST_ROW_PLAIN_CLASS = 'block px-4 py-3';
export const LIST_ROW_INTERACTIVE_CLASS =
  'cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

export type ListRowVariant = 'card' | 'plain';

type ListRowProps = React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  /** `card` (default) is the bordered mobile row; `plain` is a row inside a divided container. */
  variant?: ListRowVariant;
  /** Render as the child element (a `Link`), keeping the row classes. */
  asChild?: boolean;
  /** Loading placeholder: same box, same hover, hidden from assistive tech. */
  skeleton?: boolean;
};

export function listRowClassName(
  interactive: boolean | undefined,
  className?: string,
  variant: ListRowVariant = 'card'
): string {
  return cn(
    variant === 'plain' ? LIST_ROW_PLAIN_CLASS : LIST_ROW_BASE_CLASS,
    interactive && LIST_ROW_INTERACTIVE_CLASS,
    className
  );
}

export const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(
  ({ interactive, variant, asChild, skeleton, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        data-slot="list-row"
        data-skeleton={skeleton ? '' : undefined}
        aria-hidden={skeleton ? true : undefined}
        className={listRowClassName(interactive, className, variant)}
        {...props}
      />
    );
  }
);
ListRow.displayName = 'ListRow';
