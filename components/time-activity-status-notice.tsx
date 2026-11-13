'use client';

import { type ReactElement } from 'react';

import { Button } from '@/components/ui/button';

// The clock's line while its state loads or failed to load. A module of its own: the clock's
// sheet sits on every page, and the activity fields beside it in time-activity-fields.tsx load
// only with the dialogs that need them.

export function TimeActivityStatusNotice({
  isReady,
  statusError,
  onRetry,
}: {
  isReady: boolean;
  statusError: string | null;
  onRetry: () => void;
}): ReactElement {
  return (
    <>
      {!isReady && (
        <p role="status" className="text-sm text-muted-foreground">
          {statusError ? 'Der Zeitstatus konnte nicht sicher geladen werden.' : 'Zeitstatus wird geladen…'}
        </p>
      )}
      {statusError && (
        <Button type="button" variant="outline" onClick={onRetry}>
          Erneut laden
        </Button>
      )}
    </>
  );
}
