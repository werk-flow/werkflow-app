'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The canonical collapsible form section („Weitere Angaben"). Registry rule:
 * never use native <details>/<summary> for this — the browser's marker
 * triangle is off-brand. This component mirrors the app's established
 * expand affordance (the project-row chevron in unified-auftraege-table):
 * a ChevronRight that rotates 90° with a 200ms transition.
 */
export function FormDisclosure({
  label = 'Weitere Angaben',
  defaultOpen = false,
  children,
  className,
}: {
  label?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
        {label}
      </button>
      {open && (
        <div id={contentId} className="mt-3">
          {children}
        </div>
      )}
    </div>
  );
}
