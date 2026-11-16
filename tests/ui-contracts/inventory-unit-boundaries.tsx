import { useState } from 'react';
import { ItemDialog } from '@/components/inventar/inventory-item-dialog';
import type { ArticleTermWrites } from '@/components/inventar/use-article-terms';
import { itemToForm } from '@/components/inventar/inventory-form-state';
import { InventoryItemCardBody, InventoryItemCells } from '@/components/inventar/inventory-item-row-parts';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableRow } from '@/components/ui/table';
import type { InventoryOverviewItem } from '@/lib/inventory/types';

// An article saved before the unit list with a unit outside it, beside one
// with a listed unit: the catalog card and row mark only the first, and its
// form refuses a save until a unit from the list is chosen.

declare global {
  interface Window {
    uiContractInventorySaves: string[];
  }
}

function overviewItem(id: string, name: string, unit: string): InventoryOverviewItem {
  return {
    id,
    itemType: 'material',
    name,
    description: null,
    categoryId: null,
    unit,
    internalSku: null,
    manufacturer: null,
    supplierId: null,
    supplierArticleNumber: null,
    purchasePriceCents: 812,
    salePriceCents: 1234,
    currencyCode: 'EUR',
    taxRateBasisPoints: 1900,
    isBillable: true,
    globalMinimumStock: 0,
    globalTargetStock: null,
    trackQuantity: true,
    trackIndividualAssets: false,
    notes: null,
    isActive: true,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    categoryName: 'Rohre & Formteile',
    supplierName: null,
    primaryBarcode: null,
    barcodes: [],
    totalOnHand: 4,
    plannedQuantity: 0,
    availableQuantity: 4,
    stockStatus: 'in_stock',
    stockByLocation: [{ locationId: 'lager', locationName: 'Hauptlager', quantityOnHand: 4 }],
    assetInstanceCount: 0,
  };
}

const legacyItem = overviewItem('legacy', 'Bogen 90° 15 mm', 'Bogen');
const listedItem = overviewItem('listed', 'Kupferrohr 15 mm', 'meter');
const noop = () => undefined;

export function initializeInventoryUnitBoundary(): void {
  window.uiContractInventorySaves = [];
}

// The unit contract saves only the master data; the supplier and price tabs stay unused.
const noArticleWrites: ArticleTermWrites = {
  saveSupplier: async () => null,
  removeSupplier: async () => null,
  addPrice: async () => null,
};

export function InventoryUnitContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => itemToForm(legacyItem));
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <section aria-label="Katalogkarten" className="space-y-2">
        {[legacyItem, listedItem].map((item) => (
          <article key={item.id} aria-label={`Karte ${item.name}`} className="rounded-md border p-3">
            <InventoryItemCardBody item={item} busy={false} />
          </article>
        ))}
      </section>
      <Table aria-label="Katalogtabelle">
        <TableBody>
          {[legacyItem, listedItem].map((item) => (
            <TableRow key={item.id} aria-label={`Zeile ${item.name}`}>
              <InventoryItemCells item={item} busy={false} onEdit={noop} onAdjust={noop} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button onClick={() => setOpen(true)}>Artikel bearbeiten</Button>
      <ItemDialog
        open={open}
        onOpenChange={setOpen}
        form={form}
        setForm={setForm}
        categories={[]}
        suppliers={[]}
        locations={[]}
        savedArticle={legacyItem}
        articleTerms={{ status: 'loaded', priceDate: '2026-11-13', byItem: {} }}
        articleWrites={noArticleWrites}
        isSaving={false}
        error={null}
        onSave={() => window.uiContractInventorySaves.push(form.unit)}
      />
    </main>
  );
}
