import { useState } from 'react';
import { WholesalerImportDialog } from '@/components/inventar/wholesaler-import-dialog';
import { Button } from '@/components/ui/button';
import type { WholesalerReportLine } from '@/lib/inventory/wholesaler-import-lines';
import type {
  ConfirmWholesalerImportInput,
  WholesalerImportPreview,
  WholesalerImportResult,
} from '@/lib/inventory/wholesaler-import-schemas';

// The wholesaler import dialog over stand-ins of its actions
// (lib/inventory/wholesaler-import-actions.ts): a made-up delivery of
// „Großhandel Nordrohr“ whose unit text „Rolle 50m“ names no unit, an
// optional earlier import, and a preview that can fail.

type WholesalerImportContract = {
  uploaded: string[];
  uploadFails: boolean;
  preview: WholesalerImportPreview;
  previewError: string | null;
  confirmations: ConfirmWholesalerImportInput[];
  abandoned: string[];
};

declare global {
  interface Window {
    uiContractWholesalerImport: WholesalerImportContract;
  }
}

const PREVIEW: WholesalerImportPreview = {
  importId: 'import-1',
  delivery: {
    formatVersion: '4',
    supplierText: 'Großhandel Nordrohr GmbH, Bremen',
    date: '2037-11-02',
    fileNames: ['nordrohr-artikel.dat', 'nordrohr-preise.dat'],
  },
  units: [
    { unitText: 'Meter', articles: 120, created: 80, changed: 30, unchanged: 10, priceChanged: 25 },
    { unitText: 'Rolle 50m', articles: 5, created: 5, changed: 0, unchanged: 0, priceChanged: 0 },
    { unitText: 'Stück', articles: 40, created: 40, changed: 0, unchanged: 0, priceChanged: 0 },
  ],
  suggestedUnits: { Meter: 'meter', 'Rolle 50m': null, Stück: 'piece' },
  priceUpdates: 4,
  priceUnmatched: 1,
  removed: 2,
  rejected: 2,
  rejections: [
    {
      fileName: 'nordrohr-artikel.dat',
      lineNumber: 17,
      articleNumber: null,
      reason: 'Der Artikel hat keine Artikelnummer.',
    },
    {
      fileName: 'nordrohr-preise.dat',
      lineNumber: 4,
      articleNumber: 'NR-2201',
      reason: 'Der Zeile fehlen Angaben.',
    },
  ],
  rebateGroups: 3,
  repeat: null,
};

export function initializeWholesalerImportBoundary(): void {
  window.uiContractWholesalerImport = {
    uploaded: [],
    uploadFails: false,
    preview: PREVIEW,
    previewError: null,
    confirmations: [],
    abandoned: [],
  };
}

export async function createWholesalerImportUploadTicket(input: {
  files: { name: string }[];
}): Promise<{ success: true; uploadId: string; uploadUrls: string[]; contentType: string }> {
  return {
    success: true,
    uploadId: 'upload-1',
    uploadUrls: input.files.map((_, index) => `https://storage.example.test/upload-${index}`),
    contentType: 'application/octet-stream',
  };
}

/** The upload to storage: records the file names, or fails when the spec says so. */
export async function uploadDeliveryFiles(files: readonly File[]): Promise<boolean> {
  const contract = window.uiContractWholesalerImport;
  if (contract.uploadFails) return false;
  contract.uploaded.push(...files.map((file) => file.name));
  return true;
}

export async function previewWholesalerImport(): Promise<
  { success: true; preview: WholesalerImportPreview } | { success: false; error: string }
> {
  const contract = window.uiContractWholesalerImport;
  if (contract.previewError) return { success: false, error: contract.previewError };
  return { success: true, preview: contract.preview };
}

export async function confirmWholesalerImport(
  input: ConfirmWholesalerImportInput,
): Promise<{ success: true; result: WholesalerImportResult; alreadyConfirmed: boolean }> {
  window.uiContractWholesalerImport.confirmations.push(input);
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
}> {
  return { success: true, lines: window.uiContractWholesalerImport.preview.rejections };
}

/** The material picker's adopt; no contract here chooses a catalog row. */
export async function adoptSupplierCatalogArticle(): Promise<{ success: false; error: string }> {
  return { success: false, error: 'catalog_article_not_found' };
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
