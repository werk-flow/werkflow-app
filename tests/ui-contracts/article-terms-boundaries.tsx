import { useState } from 'react';
import { ItemDialog } from '@/components/inventar/inventory-item-dialog';
import { itemToForm } from '@/components/inventar/inventory-form-state';
import type { ArticleTermWrites } from '@/components/inventar/use-article-terms';
import { Button } from '@/components/ui/button';
import type { ArticleTerms, ArticleTermsPage } from '@/lib/inventory/article-price-terms';
import type { InventoryOverviewItem } from '@/lib/inventory/types';

// The article dialog's „Lieferanten“ and „Preise“ for a made-up article with
// two wholesalers and a price history, for one without any, and for a failed
// read of both. The writes are recorded, never sent.

declare global {
  interface Window {
    uiContractArticleTermsWrites: Array<{ write: string; input: unknown }>;
    uiContractArticleTermsRefreshes: number;
  }
}

export function initializeArticleTermsBoundary(): void {
  window.uiContractArticleTermsWrites = [];
  window.uiContractArticleTermsRefreshes = 0;
}

/** Stand-in for `next/navigation` as the retry of a failed region sees it. */
export function useRouter() {
  return {
    refresh: () => {
      window.uiContractArticleTermsRefreshes += 1;
    },
  };
}

const PRICE_DATE = '2026-11-13';

function article(id: string, name: string, supplierId: string | null): InventoryOverviewItem {
  return {
    id,
    itemType: 'material',
    name,
    description: null,
    categoryId: null,
    unit: 'meter',
    internalSku: 'MV-16',
    manufacturer: 'Rohrwerk Talheim',
    supplierId,
    supplierArticleNumber: supplierId ? 'NR-1601' : null,
    purchasePriceCents: 412,
    salePriceCents: 649,
    currencyCode: 'EUR',
    taxRateBasisPoints: 1900,
    isBillable: true,
    globalMinimumStock: 0,
    globalTargetStock: null,
    trackQuantity: true,
    trackIndividualAssets: false,
    notes: null,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    categoryName: null,
    supplierName: null,
    primaryBarcode: null,
    barcodes: [],
    totalOnHand: 0,
    plannedQuantity: 0,
    availableQuantity: 0,
    stockStatus: 'out_of_stock',
    stockByLocation: [],
    assetInstanceCount: 0,
  };
}

const SUPPLIERS = [
  { id: 'nordrohr', name: 'Großhandel Nordrohr' },
  { id: 'suedrohr', name: 'Großhandel Südrohr' },
];

const FILLED: ArticleTerms = {
  suppliers: [
    {
      id: 'ref-nord',
      supplierId: 'nordrohr',
      supplierArticleNumber: 'NR-1601',
      purchaseUnit: 'bundle',
      packQuantity: 1,
      baseQuantity: 25,
      isPreferred: true,
    },
    {
      id: 'ref-sued',
      supplierId: 'suedrohr',
      supplierArticleNumber: 'SR-77-16',
      purchaseUnit: 'roll',
      packQuantity: 1,
      baseQuantity: 50,
      isPreferred: false,
    },
  ],
  prices: [
    entry('p4', 'purchase', 43800, 100, '2027-01-01', 'manual', false),
    entry('p3', 'purchase', 41200, 100, '2026-07-01', 'csv_import', true),
    entry('s1', 'sale', 6490, 10, '2026-07-01', 'manual', true),
    entry('p1', 'purchase', 395, 1, '2026-01-01', 'carried_over', false),
  ],
};

function entry(
  id: string,
  kind: 'purchase' | 'sale',
  amountCents: number,
  priceQuantity: 1 | 10 | 100 | 1000,
  validFrom: string,
  origin: 'manual' | 'csv_import' | 'carried_over',
  isCurrent: boolean,
): ArticleTerms['prices'][number] {
  return {
    id,
    kind,
    amountCents,
    priceQuantity,
    validFrom,
    origin,
    recordedAt: `${validFrom}T07:30:00Z`,
    isCurrent,
  };
}

const VARIANTS = {
  filled: {
    label: 'Artikel mit Preisen',
    item: article('filled', 'Mehrschichtverbundrohr 16 mm', 'nordrohr'),
    terms: { status: 'loaded', priceDate: PRICE_DATE, byItem: { filled: FILLED } },
  },
  empty: {
    label: 'Artikel ohne Preise',
    item: article('empty', 'Pressfitting 16 mm', null),
    terms: { status: 'loaded', priceDate: PRICE_DATE, byItem: {} },
  },
  failed: {
    label: 'Artikel mit Lesefehler',
    item: article('failed', 'Kugelhahn 1/2"', 'nordrohr'),
    terms: { status: 'failed' },
  },
} satisfies Record<string, { label: string; item: InventoryOverviewItem; terms: ArticleTermsPage }>;

const recordingWrites: ArticleTermWrites = {
  saveSupplier: async (input) => {
    window.uiContractArticleTermsWrites.push({ write: 'saveSupplier', input });
    return { success: true, referenceId: 'ref-new' };
  },
  removeSupplier: async (referenceId) => {
    window.uiContractArticleTermsWrites.push({ write: 'removeSupplier', input: referenceId });
    return { success: true };
  },
  addPrice: async (input) => {
    window.uiContractArticleTermsWrites.push({ write: 'addPrice', input });
    return { success: true, priceId: 'price-new' };
  },
};

export function ArticleTermsContractFixture(): React.JSX.Element {
  const [variant, setVariant] = useState<keyof typeof VARIANTS | null>(null);
  const open = variant ? VARIANTS[variant] : null;
  const [form, setForm] = useState(() => itemToForm(VARIANTS.filled.item));
  return (
    <main className="space-y-4 p-4">
      <h1>Komponentenverträge</h1>
      <div className="flex flex-wrap gap-2">
        {Object.entries(VARIANTS).map(([key, value]) => (
          <Button
            key={key}
            onClick={() => {
              setForm(itemToForm(value.item));
              if (key === 'filled' || key === 'empty' || key === 'failed') setVariant(key);
            }}
          >
            {value.label}
          </Button>
        ))}
      </div>
      {open ? (
        <ItemDialog
          open
          onOpenChange={(next) => !next && setVariant(null)}
          form={form}
          setForm={setForm}
          categories={[]}
          suppliers={SUPPLIERS}
          locations={[]}
          savedArticle={open.item}
          articleTerms={open.terms}
          articleWrites={recordingWrites}
          isSaving={false}
          error={null}
          onSave={() => undefined}
        />
      ) : null}
    </main>
  );
}
