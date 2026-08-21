import { cn } from '@/lib/utils';

/**
 * The one inline error surface (feedback canon in the werkflow-design skill).
 * Renders nothing without children, so callers can pass `error && ...`-free
 * conditional messages directly. `role="alert"` announces the message to
 * screen readers the moment it appears.
 */
export function ErrorText({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!children) return null;

  return (
    <p id={id} role="alert" className={cn('text-sm text-destructive', className)}>
      {children}
    </p>
  );
}
