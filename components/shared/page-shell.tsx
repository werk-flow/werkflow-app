import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// The app shell's <main> carries no padding and no scroll region, so every
// page column owns both. Before 2026-09-03 each page hand-rolled the column
// with five different spellings; the service area had none, which left it
// flush against the sidebar with unreachable overflow. These three parts are
// the only page container. The raw class strings are lint-banned elsewhere.

const MAX_WIDTH_CLASS = {
  content: 'max-w-4xl',
  wide: 'max-w-6xl',
} as const;

export type PageBodyMaxWidth = keyof typeof MAX_WIDTH_CLASS;

export function PageShell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex h-full min-w-0 flex-col overflow-hidden', className)}>
      {children}
    </div>
  );
}

/**
 * The scroll region. Vertical only: page-level horizontal scroll is forbidden
 * on every viewport (design canon), so the region hides horizontal overflow
 * and the mobile viewport audit fails on any content that would need it.
 * The bottom padding keeps the last row clear of the clock button, which is
 * fixed at the bottom right on every authenticated page.
 */
export function PageBody({
  className,
  maxWidth,
  children,
}: {
  className?: string;
  maxWidth?: PageBodyMaxWidth;
  children: ReactNode;
}) {
  return (
    <div
      data-page-body=""
      className={cn(
        'min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-28',
        className
      )}
    >
      {maxWidth ? (
        <div className={cn('mx-auto w-full', MAX_WIDTH_CLASS[maxWidth])}>{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
