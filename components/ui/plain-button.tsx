import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A button without the `Button` look, for clickable regions that own their
 * shape: a row that opens a record, a disclosure header, a sortable column
 * head, a filter pill, a chip's remove control. It exists so the two things
 * a raw `<button>` kept losing are set once: `type="button"` (a raw button
 * inside a form submits it) and the canonical 2px focus ring. A raw
 * `<button>` outside `components/ui` is a lint error; an ordinary action
 * uses `Button`. An icon-only control needs a German `aria-label`.
 */
const PlainButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="plain-button"
      className={cn('outline-none focus-visible:ring-2 focus-visible:ring-ring/50', className)}
      {...props}
    />
  ),
);
PlainButton.displayName = 'PlainButton';

export { PlainButton };
