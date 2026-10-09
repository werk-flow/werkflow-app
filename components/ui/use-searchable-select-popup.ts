'use client';

import * as React from 'react';
import { filterByQuery } from '@/lib/ui/search';
import type {
  SearchableSelectOption,
  SearchableSelectPopupState,
} from '@/components/ui/searchable-select-popup';

function filterOptions(options: SearchableSelectOption[], search: string): SearchableSelectOption[] {
  return filterByQuery(options, search, (option) =>
    option.description ? `${option.label} ${option.description}` : option.label,
  );
}

/** Open state, search text, refs and the filtered options shared by the single and multi select. */
export function useSearchableSelectPopup(
  options: SearchableSelectOption[],
  onSearchChange: ((search: string) => void) | undefined,
): SearchableSelectPopupState {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const listboxId = React.useId();
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (nextOpen) {
      setSearch('');
      onSearchChange?.('');
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // A server-searched picker receives the matches of the whole scope, also those
  // matched on a field the label does not show; filtering them again here would hide them.
  const searchesOnServer = onSearchChange !== undefined;
  const filtered = React.useMemo(
    () => (searchesOnServer ? options : filterOptions(options, search)),
    [options, search, searchesOnServer],
  );

  return { open, setOpen, search, setSearch, changeOpen, listboxId, listRef, inputRef, triggerRef, filtered };
}
