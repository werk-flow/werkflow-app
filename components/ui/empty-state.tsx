import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

type EmptyStateProps =
  | {
      /** The block where the rows would be: icon, title, next step. The default. */
      size?: 'region';
      icon?: LucideIcon;
      title: string;
      description?: ReactNode;
      action?: ReactNode;
      className?: string;
    }
  | {
      /** One muted line inside a card section: no icon, no padding block, no action. */
      size: 'compact';
      title: string;
      /** Continues the line after the title, such as the next step. */
      description?: ReactNode;
      className?: string;
    };

/**
 * The one empty state of a list or page region. Two situations, two texts
 * (design canon, component registry): when the list itself is empty, the
 * title says "Noch keine …" and the description names the next step, with
 * the step in `action` where a button fits; when a search or filter matched
 * nothing, the title says "Keine … gefunden" and the description says how to
 * widen the search.
 *
 * Two sizes: `region` (the default) is the block where the rows of a list or
 * page region would be; `compact` is one muted line for an empty list inside
 * a card section, with the same two title patterns.
 */
export function EmptyState(props: EmptyStateProps): ReactElement {
  if (props.size === 'compact')
    return (
      <p data-slot="empty-state" className={cn('text-sm text-muted-foreground', props.className)}>
        {props.title}
        {props.description ? <> {props.description}</> : null}
      </p>
    );
  const { icon: Icon, title, description, action, className } = props;
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
