import { cn } from '@/lib/utils';

/**
 * The one loading placeholder. `data-slot="skeleton"` is the busy signal the
 * browser settle step waits on (lib/testing/spec-support/busy-signals.ts);
 * the shape is decorative, so assistive tech skips it.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
