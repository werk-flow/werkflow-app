'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';

type PendingNavigation = { query: string; knownQueries: string[] };

/** URL state owns the server page. Rapid search edits replace only the pending read. */
export function useListNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showBanner } = useBanner();
  const current = searchParams.toString();
  const pending = useRef(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [requested, setRequested] = useState<PendingNavigation | null>(null);
  // A committed URL settles this request permanently. Later navigation by a
  // different control also cancels it, while intermediate URLs from the same
  // rapid request chain must keep waiting for the latest target.
  if (requested !== null && (requested.query === current || !requested.knownQueries.includes(current))) setRequested(null);
  useEffect(() => {
    if (requested === null) {
      if (timer.current) clearTimeout(timer.current);
      pending.current = current;
    }
  }, [current, requested]);
  useEffect(() => {
    function cancelForHistory(): void {
      if (timer.current) clearTimeout(timer.current);
      pending.current = window.location.search.slice(1);
      setRequested(null);
    }
    window.addEventListener('popstate', cancelForHistory);
    return () => window.removeEventListener('popstate', cancelForHistory);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (requested === null || requested.query === current) return;
    const timeout = setTimeout(() => {
      pending.current = current;
      setRequested(null);
      showBanner({ variant: 'error', message: 'Die Liste wurde noch nicht aktualisiert. Bitte aktualisiere die Seite.' });
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [requested, current, showBanner]);
  function navigate(changes: Record<string, string | number | null>, delay = 0): void {
    const next = new URLSearchParams(pending.current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    pending.current = next.toString();
    if (timer.current) clearTimeout(timer.current);
    const query = pending.current;
    setRequested((previous) => ({ query, knownQueries: [...new Set([...(previous?.knownQueries ?? [current]), query])] }));
    const href = `${pathname}?${pending.current}`;
    if (delay) timer.current = setTimeout(() => router.replace(href, { scroll: false }), delay);
    else router.replace(href, { scroll: false });
  }
  return { navigate, busy: requested !== null && requested.query !== current };
}
