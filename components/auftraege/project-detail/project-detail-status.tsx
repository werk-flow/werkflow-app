import { cn } from '@/lib/utils';

export function TrafficLight({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const base = 'size-2.5 rounded-full shrink-0 transition-colors';
  const inactive = 'bg-muted-foreground/20';
  const label =
    status === 'green' ? 'Im Zeitplan' : status === 'yellow' ? 'Leicht verzögert' : 'Stark verzögert';
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-1.5 py-0.5"
    >
      <span aria-hidden="true" className={cn(base, status === 'red' ? 'bg-destructive' : inactive)} />
      <span aria-hidden="true" className={cn(base, status === 'yellow' ? 'bg-warning' : inactive)} />
      <span aria-hidden="true" className={cn(base, status === 'green' ? 'bg-success' : inactive)} />
    </div>
  );
}
