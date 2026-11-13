import { useState } from 'react';
import { ImportDialog } from '@/components/inventar/inventory-import-dialog';
import { Button } from '@/components/ui/button';
import type { ImportRowOutcome } from '@/lib/inventory/csv-import';

// The CSV import dialog over stand-ins of its three actions
// (lib/inventory/import-actions.ts): the repeat check answers what the spec
// sets, the preview can be held open, and the booking succeeds or fails.

type ImportContract = {
  repeatChecks: number;
  repeatAnswer: { bookedAt: string; bookedBy: string } | null;
  previewModes: string[];
  previewRows: ImportRowOutcome[];
  holdPreview: boolean;
  releasePreview: (() => void) | null;
  bookFails: boolean;
  bookRows: ImportRowOutcome[] | null;
  bookedBatches: string[];
};

declare global {
  interface Window {
    uiContractImport: ImportContract;
  }
}

export function initializeInventoryImportBoundary(): void {
  window.uiContractImport = {
    repeatChecks: 0,
    repeatAnswer: null,
    previewModes: [],
    previewRows: [],
    holdPreview: false,
    releasePreview: null,
    bookFails: false,
    bookRows: null,
    bookedBatches: [],
  };
}

export async function findInventoryImportRepeat(): Promise<
  { success: true; repeat: { bookedAt: string; bookedBy: string } | null } | { success: false; error: string }
> {
  const contract = window.uiContractImport;
  contract.repeatChecks += 1;
  return { success: true, repeat: contract.repeatAnswer };
}

export async function previewInventoryImport(input: {
  mode: string;
}): Promise<
  { success: true; batchId: string; rows: ImportRowOutcome[] } | { success: false; error: string }
> {
  const contract = window.uiContractImport;
  contract.previewModes.push(input.mode);
  if (contract.holdPreview) {
    await new Promise<void>((resolve) => {
      contract.releasePreview = resolve;
    });
  }
  return { success: true, batchId: `batch-${contract.previewModes.length}`, rows: contract.previewRows };
}

export async function bookInventoryImport(input: {
  batchId: string;
}): Promise<
  { success: true; alreadyBooked: boolean; rows: ImportRowOutcome[] } | { success: false; error: string }
> {
  const contract = window.uiContractImport;
  if (contract.bookFails) return { success: false, error: 'save_failed' };
  contract.bookedBatches.push(input.batchId);
  return { success: true, alreadyBooked: false, rows: contract.bookRows ?? contract.previewRows };
}

export function InventoryImportContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <Button onClick={() => setOpen(true)}>CSV importieren</Button>
      <ImportDialog open={open} onOpenChange={setOpen} existingItemCount={0} locations={[]} categories={[]} />
    </main>
  );
}
