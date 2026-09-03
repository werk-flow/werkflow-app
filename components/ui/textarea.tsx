'use client';

import * as React from 'react';

import { useFieldContext } from '@/components/ui/field';
import { cn } from '@/lib/utils';

// Inside a `Field`, the id, describedby, invalid and required attributes come
// from the field context unless the caller sets them. `rows` is deliberately
// not part of the canon: the textarea sizes to its content (`field-sizing`).
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  (
    {
      className,
      id,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      'aria-required': ariaRequired,
      ...props
    },
    ref
  ) => {
    const field = useFieldContext();
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        id={id ?? field?.controlId}
        aria-describedby={ariaDescribedBy ?? field?.describedBy}
        aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
        aria-required={ariaRequired ?? (field?.required || undefined)}
        className={cn(
          'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';

export { Textarea };
