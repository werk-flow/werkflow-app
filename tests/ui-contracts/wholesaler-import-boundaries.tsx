import { useState } from 'react';
import { WholesalerImportDialog } from '@/components/inventar/wholesaler-import-dialog';
import { Button } from '@/components/ui/button';
import type { WholesalerReportLine } from '@/lib/inventory/wholesaler-import-lines';
import type {
  ConfirmWholesalerImportInput,
  OpenWholesalerImportInput,
  StageWholesalerImportLinesInput,
  WholesalerImportPreview,
  WholesalerImportResult,
  WholesalerPreviewEffects,
} from '@/lib/inventory/wholesaler-import-schemas';

// The wholesaler import dialog over stand-ins of its actions
// (lib/inventory/wholesaler-import-actions.ts). The browser path is real: the
// dialog reads the chosen files through lib/inventory/wholesaler-reader.ts,
// whose reader is the fake in ./wholesaler-reader-boundaries.ts, and sends the
// parsed lines in parts. The stand answers the database's effects: a made-up
// delivery of „Großhandel Nordrohr“ whose unit text „Rolle 50m“ names no
// unit, an optional earlier import, and a preview that can fail.

type WholesalerImportContract = {
  /** The file names the fake reader got, and whether it fails or how many „Meter“ articles it reads. */
  read: string[];
  readerFails: boolean;
  meterArticles: number;
  opened: OpenWholesalerImportInput[];
  /** Each staging call's lines, in the order they arrived. */
  staged: StageWholesalerImportLinesInput['lines'][];
  stageError: string | null;
  /** Keeps every staging call waiting, so the dialog stays on its sending line. */
  stageHeld: boolean;
  effects: WholesalerPreviewEffects;
  repeat: WholesalerImportPreview['repeat'];
  previewError: string | null;
  /** Keeps the confirm waiting after it records its input, so the dialog stays pending. */
  confirmHeld: boolean;
  confirmations: ConfirmWholesalerImportInput[];
  abandoned: string[];
};

declare global {
  interface Window {
    uiContractWholesalerImport: WholesalerImportContract;
  }
}

const EFFECTS: WholesalerPreviewEffects = {
  units: [
    {
      unitText: 'Meter',
      articles: 120,
      created: 80,
      changed: 30,
      unchanged: 10,
      unchangedByUnit: { meter: 10 },
      priceChanged: 25,
    },
    {
      unitText: 'Rolle 50m',
      articles: 5,
      created: 5,
      changed: 0,
      unchanged: 0,
      unchangedByUnit: {},
      priceChanged: 0,
    },
    {
      unitText: 'Stück',
      articles: 40,
      created: 40,
      changed: 0,
      unchanged: 0,
      unchangedByUnit: {},
      priceChanged: 0,
    },
  ],
  priceUpdates: 4,
  priceUnmatched: 1,
  removed: 2,
  rejected: 2,
};

/** The report of the stand's confirmed import. */
const REPORT: WholesalerReportLine[] = [
  {
    fileName: 'nordrohr-artikel.dat',
    lineNumber: 17,
    articleNumber: null,
    reason: 'Der Artikel hat keine Artikelnummer.',
  },
  {
    fileName: 'nordrohr-preise.dat',
    lineNumber: 4,
    articleNumber: null,
    reason: 'Der Zeile fehlen Angaben.',
  },
];

export function initializeWholesalerImportBoundary(): void {
  window.uiContractWholesalerImport = {
    read: [],
    readerFails: false,
    meterArticles: 120,
    opened: [],
    staged: [],
    stageError: null,
    stageHeld: false,
    effects: EFFECTS,
    repeat: null,
    previewError: null,
    confirmHeld: false,
    confirmations: [],
    abandoned: [],
  };
}

export async function openWholesalerImport(
  input: OpenWholesalerImportInput,
): Promise<{ success: true; importId: string }> {
  window.uiContractWholesalerImport.opened.push(input);
  return { success: true, importId: 'import-1' };
}

export async function stageWholesalerImportLines(
  input: StageWholesalerImportLinesInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const contract = window.uiContractWholesalerImport;
  if (contract.stageHeld) return new Promise(() => undefined);
  if (contract.stageError) return { success: false, error: contract.stageError };
  contract.staged.push(input.lines);
  return { success: true };
}

export async function previewWholesalerImport(): Promise<
  | { success: true; effects: WholesalerPreviewEffects; repeat: WholesalerImportPreview['repeat'] }
  | { success: false; error: string }
> {
  const contract = window.uiContractWholesalerImport;
  if (contract.previewError) return { success: false, error: contract.previewError };
  return { success: true, effects: contract.effects, repeat: contract.repeat };
}

export async function confirmWholesalerImport(
  input: ConfirmWholesalerImportInput,
): Promise<{ success: true; result: WholesalerImportResult; alreadyConfirmed: boolean }> {
  const contract = window.uiContractWholesalerImport;
  contract.confirmations.push(input);
  if (contract.confirmHeld) return new Promise(() => undefined);
  return {
    success: true,
    alreadyConfirmed: false,
    result: {
      created: 125,
      changed: 30,
      unchanged: 10,
      priceChanged: 25,
      unitRejected: 0,
      priceUpdates: 4,
      priceUnmatched: 1,
      removed: 2,
      rejected: 2,
    },
  };
}

export async function abandonWholesalerImport(input: { importId: string }): Promise<{ success: true }> {
  window.uiContractWholesalerImport.abandoned.push(input.importId);
  return { success: true };
}

export async function readWholesalerImportReport(): Promise<{
  success: true;
  lines: WholesalerReportLine[];
  next: null;
}> {
  return { success: true, lines: REPORT, next: null };
}

const SUPPLIERS = [{ id: 'nordrohr', name: 'Großhandel Nordrohr' }];

export function WholesalerImportContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <Button onClick={() => setOpen(true)}>Großhandel importieren</Button>
      <WholesalerImportDialog open={open} onOpenChange={setOpen} suppliers={SUPPLIERS} />
    </main>
  );
}
