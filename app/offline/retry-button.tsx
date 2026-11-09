'use client';

import { RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';

/** Reloads the address the person opened; offline, the service worker answers with this page again. */
export function RetryButton() {
  const hydrated = useHydrated();
  return (
    <Button type="button" disabled={!hydrated} onClick={() => window.location.reload()}>
      <RotateCw />
      Erneut versuchen
    </Button>
  );
}
