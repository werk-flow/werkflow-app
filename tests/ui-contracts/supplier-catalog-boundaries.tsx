import { useState } from 'react';
import type { MaterialDialogState } from '@/components/inventar/job-material-dialog-model';
import { SupplierCatalogOptions } from '@/components/inventar/supplier-catalog-options';
import { Input } from '@/components/ui/input';
import type { InventoryPickerOption } from '@/lib/inventory/types';
import type { SupplierCatalogOption } from '@/lib/inventory/wholesaler-import-schemas';

// The material dialog's catalog options over a stand-in of the catalog search
// and the adopt (lib/inventory/supplier-catalog-actions.ts): one made-up
// catalog article of „Großhandel Nordrohr“, and an adopt that waits until the
// spec answers it with a refusal.

type SupplierCatalogContract = {
  adopted: string[];
  /** Answers the waiting adopt with a refusal; null while none waits. */
  refuseAdopt: (() => void) | null;
};

declare global {
  interface Window {
    uiContractSupplierCatalog: SupplierCatalogContract;
  }
}

const OPTION: SupplierCatalogOption = {
  id: '37500000-0000-4000-8000-000000000071',
  supplierName: 'Großhandel Nordrohr',
  articleNumber: 'NR-1501',
  name: 'Kupferrohr 15 mm',
  nameAddition: 'hart',
  unit: 'meter',
  priceKind: 'list',
  priceCents: 61000,
  priceQuantity: 100,
};

export function initializeSupplierCatalogBoundary(): void {
  window.uiContractSupplierCatalog = { adopted: [], refuseAdopt: null };
}

export async function readSupplierCatalogContract(): Promise<{
  success: true;
  options: SupplierCatalogOption[];
  hasMore: boolean;
}> {
  return { success: true, options: [OPTION], hasMore: false };
}

export function adoptSupplierCatalogArticle(input: {
  catalogArticleId: string;
}): Promise<{ success: false; error: string }> {
  const contract = window.uiContractSupplierCatalog;
  contract.adopted.push(input.catalogArticleId);
  return new Promise((resolve) => {
    contract.refuseAdopt = () => resolve({ success: false, error: 'catalog_article_not_found' });
  });
}

export function SupplierCatalogContractFixture(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [, setDialog] = useState<MaterialDialogState | null>(null);
  const [, setPickerItems] = useState<InventoryPickerOption[]>([]);
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <Input
        aria-label="Material suchen"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <SupplierCatalogOptions
        source={{ setDialog, picker: { setPickerItems, pickerLocations: [] } }}
        search={search}
      />
    </main>
  );
}
