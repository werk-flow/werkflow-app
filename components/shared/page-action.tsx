'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

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
  return (
    <PageActionContext.Provider value={value}>{children}</PageActionContext.Provider>
  );
}

export function usePageAction(): PageActionState {
  const state = useContext(PageActionContext);
  if (!state) {
    throw new Error('usePageAction must be used inside a PageActionProvider.');
  }
  return state;
}

/** The header button that opens the page's primary dialog. */
export function PageActionButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { setOpen } = usePageAction();
  return (
    <Button className={className} onClick={() => setOpen(true)}>
      {children}
    </Button>
  );
}
