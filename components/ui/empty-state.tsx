import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The one empty state of a list or page region. Two situations, two texts
 * (design canon, component registry): when the list itself is empty, the
 * title says "Noch keine …" and the description names the next step, with
 * the step in `action` where a button fits; when a search or filter matched
 * nothing, the title says "Keine … gefunden" and the description says how to
 * widen the search. Compact one-line notes inside a card section stay plain
 * muted text; this block is for the place where the rows would be.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center justify-center px-4 py-12 text-center', className)}
    >
      {Icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
