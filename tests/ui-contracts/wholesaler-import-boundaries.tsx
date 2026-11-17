import { useState } from 'react';
import { WholesalerImportDialog } from '@/components/inventar/wholesaler-import-dialog';
import { Button } from '@/components/ui/button';
import type { WholesalerReportLine } from '@/lib/inventory/wholesaler-import-lines';
import type {
  ConfirmWholesalerImportInput,
  OpenWholesalerImportInput,
  PreviewWholesalerPricesInput,
  StageWholesalerImportLinesInput,
  WholesalerImportPreview,
  WholesalerImportResult,
  WholesalerPreviewEffects,
  WholesalerPriceChange,
  WholesalerPricePreview,
} from '@/lib/inventory/wholesaler-import-schemas';

// The wholesaler import dialog over stand-ins of its actions
// (lib/inventory/wholesaler-import-actions.ts). The browser path is real: the
// dialog reads the chosen files through lib/inventory/wholesaler-reader.ts,
// whose reader is the fake in ./wholesaler-reader-boundaries.ts, and sends the
// parsed lines in parts. The stand answers the database's effects: a made-up
// delivery of „Großhandel Nordrohr“ whose unit text „Rolle 50m“ names no
// unit, an optional earlier import, and a preview that can fail. Its price
// preview changes four own articles' prices; the pipe's purchase price is its
// list price minus the rebate of group „CU1“, which the stand computes for
// any rebate the dialog sends.

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
  /** Each price preview's input, in the order they arrived. */
  pricings: PreviewWholesalerPricesInput[];
  pricingError: string | null;
  /** Keeps the confirm waiting after it records its input, so the dialog stays pending. */
  confirmHeld: boolean;
  /** The refusal the next confirm answers, such as prices_changed. */
  confirmError: string | null;
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

const TODAY = '2037-11-17';

/** The pipe's purchase price for a rebate of group „CU1“, as the database computes it. */
function pipePurchase(rebateBasisPoints: number): WholesalerPriceChange {
  return {
    itemId: 'item-pipe',
    itemName: 'Kupferrohr 15 mm',
    itemUnit: 'meter',
    articleNumber: 'NR-1501',
    unitText: 'Meter',
    catalogUnit: null,
    kind: 'purchase',
    rebateGroup: 'CU1',
    rebateBasisPoints,
    old: { amountCents: 400, priceQuantity: 1 },
    new: { amountCents: Math.round((61000 * (10_000 - rebateBasisPoints)) / 10_000), priceQuantity: 100 },
    validFrom: TODAY,
  };
}

/** The own articles' price changes for the rebates; a rebate of CU1 adds the pipe's purchase price. */
function pricePreview(rebates: Record<string, number | null>): WholesalerPricePreview {
  const pipeRebate = rebates.CU1 ?? null;
  const changes: WholesalerPriceChange[] = [
    {
      itemId: 'item-valve',
      itemName: 'Kugelhahn 1/2"',
      itemUnit: 'piece',
      articleNumber: 'NR-1503',
      unitText: null,
      catalogUnit: 'piece',
      kind: 'purchase',
      rebateGroup: null,
      rebateBasisPoints: null,
      old: { amountCents: 1250, priceQuantity: 1 },
      new: { amountCents: 1300, priceQuantity: 1 },
      validFrom: TODAY,
    },
    ...(pipeRebate === null ? [] : [pipePurchase(pipeRebate)]),
    {
      itemId: 'item-pipe',
      itemName: 'Kupferrohr 15 mm',
      itemUnit: 'meter',
      articleNumber: 'NR-1501',
      unitText: 'Meter',
      catalogUnit: null,
      kind: 'sale',
      rebateGroup: 'CU1',
      rebateBasisPoints: null,
      old: { amountCents: 500, priceQuantity: 1 },
      new: { amountCents: 61000, priceQuantity: 100 },
      validFrom: TODAY,
    },
    {
      itemId: 'item-roll',
      itemName: 'Mehrschichtverbundrohr 16 mm',
      itemUnit: 'roll',
      articleNumber: 'NR-1601',
      unitText: 'Rolle 50m',
      catalogUnit: null,
      kind: 'sale',
      rebateGroup: 'AR1',
      rebateBasisPoints: null,
      old: null,
      new: { amountCents: 9900, priceQuantity: 1 },
      validFrom: TODAY,
    },
  ];
  return {
    rebateGroups: [
      { rebateGroup: 'AR1', text: 'Armaturen', officeBasisPoints: null, deliveryBasisPoints: null },
      { rebateGroup: 'CU1', text: 'Kupfer', officeBasisPoints: null, deliveryBasisPoints: 3000 },
    ],
    rebates,
    changes,
    // A stand's fingerprint per rebate of CU1, as the database answers one per set of changes.
    fingerprint: (pipeRebate ?? 0).toString(16).padStart(32, '0'),
  };
}

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
    pricings: [],
    pricingError: null,
    confirmHeld: false,
    confirmError: null,
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

export async function previewWholesalerPrices(
  input: PreviewWholesalerPricesInput,
): Promise<{ success: true; prices: WholesalerPricePreview } | { success: false; error: string }> {
  const contract = window.uiContractWholesalerImport;
  contract.pricings.push(input);
  if (contract.pricingError) return { success: false, error: contract.pricingError };
  // At first the delivery's 30 % for CU1 and no rebate for AR1.
  return { success: true, prices: pricePreview(input.rebates ?? { AR1: null, CU1: 3000 }) };
}

export async function confirmWholesalerImport(
  input: ConfirmWholesalerImportInput,
): Promise<
  | { success: true; result: WholesalerImportResult; alreadyConfirmed: boolean }
  | { success: false; error: string }
> {
  const contract = window.uiContractWholesalerImport;
  contract.confirmations.push(input);
  if (contract.confirmHeld) return new Promise(() => undefined);
  if (contract.confirmError) {
    const error = contract.confirmError;
    contract.confirmError = null;
    return { success: false, error };
  }
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
      ownPricesChanged: 3,
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
