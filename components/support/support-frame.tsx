'use client';

import { useRef, type ReactNode } from 'react';

import { usePageBodyKeyboardScroll } from '@/components/shared/page-body-keyboard-scroll';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The frame of support's area: the screen's one main landmark at full
 * height, which each page fills with its own page column. No sidebar and no
 * clock dock: support works on reports and nothing else.
 */
export function SupportFrame({ children }: { children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  usePageBodyKeyboardScroll(mainRef);
  return (
    <main ref={mainRef} className="h-dvh overflow-hidden bg-background">
      {children}
    </main>
  );
}

/** The frame before the caller is known: a header line and a content block, no word of the area. */
export function SupportFrameSkeleton() {
  return (
    <div className="h-dvh overflow-hidden bg-background p-4 sm:p-6">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48 rounded" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}
