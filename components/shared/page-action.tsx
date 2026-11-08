'use client';

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';

// A page's primary action button sits in the static PageHeader, while the
// dialog it opens lives in the suspended content because it needs the loaded
// data. This pair shares the open flag across that Suspense boundary so the
// header paints before the data arrives (/auftraege, /arbeitsvorlagen).

/** A dialog that loads on demand (`lazyDialog`): its download and whether an open waits for it. */
type PageActionLoader = { preload: () => void; waiting: boolean };

interface PageActionState {
  open: boolean;
  setOpen: (open: boolean) => void;
  setLoader: (loader: PageActionLoader | null) => void;
}

const PageActionContext = createContext<PageActionState | null>(null);
// Only the button reads the loader, so registering it never re-renders the page content.
const PageActionLoaderContext = createContext<PageActionLoader | null>(null);

export function PageActionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loader, setLoader] = useState<PageActionLoader | null>(null);
  const value = useMemo<PageActionState>(() => ({ open, setOpen, setLoader }), [open]);
  return (
    <PageActionContext.Provider value={value}>
      <PageActionLoaderContext.Provider value={loader}>{children}</PageActionLoaderContext.Provider>
    </PageActionContext.Provider>
  );
}

export function usePageAction(): PageActionState {
  const state = useContext(PageActionContext);
  if (!state) {
    throw new Error('usePageAction must be used inside a PageActionProvider.');
  }
  return state;
}

/**
 * Hands the header button a dialog that loads on demand: the button starts the
 * download on hover, focus or press, and shows pending while an open waits for it.
 */
export function usePageActionLoader(preload: (() => void) | null, waiting: boolean): void {
  const { setLoader } = usePageAction();
  useLayoutEffect(() => {
    setLoader(preload ? { preload, waiting } : null);
    return () => setLoader(null);
  }, [setLoader, preload, waiting]);
}

/** The header button that opens the page's primary dialog. */
export function PageActionButton({ className, children }: { className?: string; children: ReactNode }) {
  const { setOpen } = usePageAction();
  const loader = useContext(PageActionLoaderContext);
  const hydrated = useHydrated();
  const preload = loader?.preload;
  return (
    <Button
      className={className}
      disabled={!hydrated}
      pending={loader?.waiting ?? false}
      onPointerEnter={preload}
      onFocus={preload}
      onPointerDown={preload}
      onClick={() => setOpen(true)}
    >
      {children}
    </Button>
  );
}

// The document library's header menu calls handlers that only exist once the
// library has loaded (upload inputs, the folder dialog), so an open flag is
// not enough. The static header renders an empty slot and the suspended
// content portals its actions into it: the title paints first, the actions
// arrive with the data they need.

interface PageHeaderSlotState {
  slot: HTMLElement | null;
  setSlot: (slot: HTMLElement | null) => void;
}

const PageHeaderSlotContext = createContext<PageHeaderSlotState | null>(null);

export function PageHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo<PageHeaderSlotState>(() => ({ slot, setSlot }), [slot]);
  return <PageHeaderSlotContext.Provider value={value}>{children}</PageHeaderSlotContext.Provider>;
}

/** The empty target inside `PageHeader`'s `actions`. */
export function PageHeaderSlot() {
  const state = useContext(PageHeaderSlotContext);
  return <div ref={state?.setSlot} className="contents" />;
}

/** Renders its children into the header slot; nothing outside a provider (the org-switch overlay). */
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageHeaderSlotContext)?.slot;
  return slot ? createPortal(children, slot) : null;
}
