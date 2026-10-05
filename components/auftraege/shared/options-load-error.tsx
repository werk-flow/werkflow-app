'use client';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';

/** The failed option load of a dialog, with the retry that reloads the options. */
export function OptionsLoadError({
  error,
  onRetry,
  retrying,
}: {
  error: string | null | undefined;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <ErrorText>{error}</ErrorText>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        Erneut laden
      </Button>
    </div>
  );
}
