'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Input, type InputProps } from '@/components/ui/input';
import { PlainButton } from '@/components/ui/plain-button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type SearchInputProps = Omit<InputProps, 'type' | 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Spinner at the end of the field while a search read runs. */
  pending?: boolean;
  /** Width and placement of the field; `className` styles the input itself. */
  wrapperClassName?: string;
};

/**
 * The one search field of a list, picker or toolbar: a magnifier at the start,
 * and at the end a clear button once something is typed (or a spinner while a
 * read runs). Clearing returns focus to the field. Name it with `aria-label`,
 * or place it in a `Field` with a hidden label.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, pending = false, wrapperClassName, className, ...props },
  ref,
) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={setRefs}
        type="text"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn('pl-9 pr-9', className)}
        {...props}
      />
      {pending ? (
        <Spinner
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          label="Einträge werden gesucht"
        />
      ) : value ? (
        <PlainButton
          aria-label="Suche leeren"
          onClick={() => {
            onValueChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </PlainButton>
      ) : null}
    </div>
  );
});
