'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';

// A page's primary action button sits in the static PageHeader, while the
// dialog it opens lives in the suspended content because it needs the loaded
// data. This pair shares the open flag across that Suspense boundary so the
// header paints before the data arrives (/auftraege, /arbeitsvorlagen).

interface PageActionState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PageActionContext = createContext<PageActionState | null>(null);

export function PageActionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<PageActionState>(() => ({ open, setOpen }), [open]);
  return <PageActionContext.Provider value={value}>{children}</PageActionContext.Provider>;
}

export function usePageAction(): PageActionState {
  const state = useContext(PageActionContext);
  if (!state) {
    throw new Error('usePageAction must be used inside a PageActionProvider.');
  }
  return state;
}

/** The header button that opens the page's primary dialog. */
export function PageActionButton({ className, children }: { className?: string; children: ReactNode }) {
  const { setOpen } = usePageAction();
  const hydrated = useHydrated();
  return (
    <Button className={className} disabled={!hydrated} onClick={() => setOpen(true)}>
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
