import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The boxed failure state of one section or page region (loading canon:
 * sections load and fail independently; one failed section shows its own
 * error and retry while the rest of the page stays usable). `ErrorText` is
 * the inline form error; this is the block for a region that could not load.
 * Announces once via `role="alert"`; the optional retry is a real button.
 */
export function SectionError({
  title,
  children,
  onRetry,
  retryLabel = 'Erneut laden',
  retryPending = false,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retryPending?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-destructive/30 bg-card p-4 text-sm sm:flex-row sm:items-start sm:justify-between',
        className
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
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
