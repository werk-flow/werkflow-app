'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Whether the offer's editor holds changes it has not saved. The preview and
// „Als gesendet festhalten“ show and file the saved draft, so they ask first:
// a send would freeze the offer and drop what was typed since the last save.

type UnsavedState = { unsaved: boolean; report: (unsaved: boolean) => void };

const OfferUnsavedContext = createContext<UnsavedState | null>(null);

/** Around one offer's page: its editor reports, its preview reads. */
export function OfferUnsavedProvider({ children }: { children: ReactNode }) {
  const [unsaved, report] = useState(false);
  return <OfferUnsavedContext.Provider value={{ unsaved, report }}>{children}</OfferUnsavedContext.Provider>;
}

/** The editor's report; released when the editor unmounts. */
export function useReportOfferUnsaved(unsaved: boolean): void {
  const report = useContext(OfferUnsavedContext)?.report;
  useEffect(() => {
    if (!unsaved) return;
    report?.(true);
    return () => report?.(false);
  }, [unsaved, report]);
}

/** Whether the editor holds unsaved changes now. */
export function useOfferUnsaved(): boolean {
  return useContext(OfferUnsavedContext)?.unsaved ?? false;
}
