import type { ReactElement } from 'react';

/**
 * One labelled value of a service detail page, as a dt/dd pair. A description list allows one
 * div around each pair, never a second wrapper (axe definition-list).
 */
export function Fact({
  label,
  value,
  className,
  testId,
  keepLineBreaks = false,
}: {
  label: string;
  value: string | null | undefined;
  className?: string | undefined;
  testId?: string | undefined;
  /** Shows the line breaks of a free-text value. */
  keepLineBreaks?: boolean;
}): ReactElement {
  return (
    <div className={className} data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={keepLineBreaks ? 'mt-1 whitespace-pre-wrap text-sm' : 'mt-1 text-sm'}>
        {value || 'Nicht erfasst'}
      </dd>
    </div>
  );
}
