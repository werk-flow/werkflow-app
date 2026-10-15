import * as React from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * A link inside running text, such as a helper text or a sentence that names
 * a record. It is always underlined: next to muted text, the orange link
 * color alone is not told apart in every theme (WCAG 1.4.1, axe
 * `link-in-text-block`). A standalone link uses `Button variant="link"`.
 */
export function TextLink({ className, ...props }: React.ComponentProps<typeof Link>): React.JSX.Element {
  return (
    <Link
      data-slot="text-link"
      className={cn(
        'rounded-sm text-primary-text underline underline-offset-2 hover:text-primary-text-hover active:text-primary-text-active',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}
