'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Marks a region as usable content for measured navigation (Step 2, PF-22).
 * The attribute is written from an effect, so it exists only after the
 * client committed the region: server HTML alone never carries it, and a
 * browser measurement that waits for it proves hydration and data together.
 * `count` lets a test assert the rendered size against the seeded profile.
 */
export function UsableContent({
  name,
  count,
  children,
}: {
  name: string;
  count?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.dataset.usableContent = 'ready';
    if (count !== undefined) element.dataset.usableCount = String(count);
    else delete element.dataset.usableCount;
  }, [count]);
  return (
    <div ref={ref} data-usable-content-name={name} className="contents">
      {children}
    </div>
  );
}
