'use client';

import { memo, useCallback, useEffect, useState } from 'react';
// eslint-disable-next-line no-restricted-syntax -- the opener of the search dialog is a button, not a field: the dialog's own field is SearchInput
import { Search } from 'lucide-react';

import { lazyDialog } from '@/components/shared/lazy-dialog';
import { Button } from '@/components/ui/button';
import { useAnyDialogOpen } from '@/components/ui/open-dialog-context';
import { useHydrated } from '@/hooks/use-hydrated';
import type { GlobalSearchDialogProps } from './global-search-dialog';

// The header search's opener in the app shell. The dialog, its reads and its
// results load on the first intent (hover, focus, press, the shortcut), so no
// page's cold start and no clock action carries them.

const searchDialog = lazyDialog<GlobalSearchDialogProps>(() =>
  import('./global-search-dialog').then((module) => module.GlobalSearchDialog),
);

/** Ctrl+K, or Cmd+K on a Mac, opens the search from anywhere on the desktop. */
function useSearchShortcut(enabled: boolean, open: () => void): void {
  const anotherDialogOpen = useAnyDialogOpen();
  useEffect(() => {
    if (!enabled || anotherDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || event.defaultPrevented || event.repeat) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, anotherDialogOpen, open]);
}

/**
 * „Suchen“: a field-like button under the organization switcher on the
 * desktop, an icon in the phone header. Before hydration it keeps its box
 * empty, so the server HTML carries no control without its events.
 */
export const GlobalSearchButton = memo(function GlobalSearchButton({
  placement,
}: {
  placement: 'header' | 'sidebar';
}) {
  const [open, setOpen] = useState(false);
  const waiting = searchDialog.useWaiting(open);
  const hydrated = useHydrated();
  const openSearch = useCallback((): void => {
    searchDialog.preload();
    setOpen(true);
  }, []);
  useSearchShortcut(placement === 'sidebar', openSearch);
  const intent = { onPointerEnter: searchDialog.preload, onFocus: searchDialog.preload };

  if (!hydrated) return <div className={placement === 'header' ? 'size-11' : 'h-9'} />;
  return (
    <>
      {placement === 'header' ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Suchen"
          pending={waiting}
          onClick={openSearch}
          {...intent}
        >
          <Search className="size-5" />
        </Button>
      ) : (
        <Button
          variant="outline"
          className="w-full justify-start gap-2 px-3 font-normal text-muted-foreground"
          aria-keyshortcuts="Control+K Meta+K"
          pending={waiting}
          onClick={openSearch}
          {...intent}
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Suchen</span>
        </Button>
      )}
      <searchDialog.Dialog open={open} onOpenChange={setOpen} />
    </>
  );
});
