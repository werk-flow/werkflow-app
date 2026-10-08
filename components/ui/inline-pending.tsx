import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * The spinner that sits where a change is happening: beside the row button,
 * in the section header, next to the toggled control (feedback canon: every
 * mutation shows something at the point of action within the first frame).
 * `keepSpace` reserves the slot so a row does not shift when the spinner
 * appears.
 */
export function InlinePending({
  active,
  label = 'Wird gespeichert',
  keepSpace = false,
  className,
}: {
  active: boolean;
  /** German status text for assistive tech. */
  label?: string;
  keepSpace?: boolean;
  className?: string | undefined;
}) {
  if (!active && !keepSpace) return null;
  return (
    <span
      role={active ? 'status' : undefined}
      aria-label={active ? label : undefined}
      aria-hidden={active ? undefined : true}
      className={cn('inline-flex size-4 shrink-0 items-center justify-center', className)}
    >
      {active && <Spinner className="text-muted-foreground" />}
    </span>
  );
}
