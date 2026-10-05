import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The title row of a subpage inside an area layout: the `h2` with the subpage
 * name one step below the area's `PageHeader` title, a short description, and
 * the subpage's primary actions on the right. On a narrow screen the actions
 * wrap below the text. Sections inside the subpage use `h3`.
 */
export function SubpageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0 max-w-2xl space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions}
    </div>
  );
}
