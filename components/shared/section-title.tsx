import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The title of a card or section on a detail page („PROFIL“, „DOKUMENTE &
 * BILDER“): small, uppercase and muted, with an optional leading icon. One
 * spelling for every detail card, so neighbouring cards cannot drift into
 * different title styles. `as` keeps the heading level right for its place.
 */
export function SectionTitle({
  as: Heading = 'h3',
  id,
  icon,
  className,
  children,
}: {
  as?: 'h2' | 'h3' | 'h4';
  /** For `aria-labelledby` on the section the title names. */
  id?: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Heading
      id={id}
      className={cn(
        'flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
    >
      {icon}
      {children}
    </Heading>
  );
}
