import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ReadFailure } from '@/hooks/use-client-read';
import { cn } from '@/lib/utils';

/**
 * The boxed failure state of one section or page region (loading canon:
 * sections load and fail independently; one failed section shows its own
 * error and retry while the rest of the page stays usable). `ErrorText` is
 * the inline form error; this is the block for a region that could not load.
 * Announces once via `role="alert"`; the optional retry is a real button,
 * always named „Erneut laden“ so every failed region offers the same step.
 * A failed client read passes `failure` (hooks/use-client-read.ts), which
 * brings its message and its retry together.
 */
export function SectionError({
  title,
  className,
  ...content
}: {
  title?: string;
  className?: string;
} & (
  | { failure: ReadFailure; children?: never; onRetry?: never; retryPending?: never }
  | { failure?: never; children: React.ReactNode; onRetry?: () => void; retryPending?: boolean }
)) {
  const children = content.failure ? content.failure.message : content.children;
  const onRetry = content.failure ? content.failure.retry : content.onRetry;
  const retryPending = content.failure ? content.failure.retrying : (content.retryPending ?? false);
  return (
    <div
      role="alert"
      data-slot="section-error"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-destructive/30 bg-card p-4 text-sm sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-0.5">
          {title && <p className="font-medium text-foreground">{title}</p>}
          <div className="text-destructive">{children}</div>
        </div>
      </div>
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={retryPending}
          className="shrink-0 self-start"
        >
          Erneut laden
        </Button>
      )}
    </div>
  );
}
