'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface AreaNavItem {
  href: string;
  label: string;
  /** Match only the exact path; default matches the path and everything below it. */
  exact?: boolean;
}

/**
 * Route-level subnavigation for an area with subpages (Zeiterfassung,
 * Service). Underlined tabs on the header's bottom edge, driven by the
 * pathname, so they never look like the in-page state tabs (shadcn `Tabs`,
 * filled pills). Lives in the area's `layout.tsx` inside `PageHeader`'s
 * `nav` slot, so it stays on screen across subpages and loading states.
 * Scrolls within itself on narrow screens instead of widening the page.
 */
export function AreaNav({
  items,
  ariaLabel,
}: {
  items: readonly AreaNavItem[];
  ariaLabel: string;
}): ReactElement {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [scrollbar-width:none]"
    >
      <div className="flex h-9 gap-1 whitespace-nowrap">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
