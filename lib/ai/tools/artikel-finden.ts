import 'server-only';

import { untrustedText } from '@/lib/ai/context';
import { defineTool } from '@/lib/ai/tools/define-tool';
import { inventoryPageQuerySchema } from '@/lib/inventory/list-page';
import { readInventoryOverview } from '@/lib/inventory/overview-read';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

/** The articles one call returns, of the page's first 50. */
const RESULT_LIMIT = 10;

const record = (text: string | null) => (text ? untrustedText('record_text', text) : null);

/**
 * Articles with their stock and supplier references through the reader of
 * `/inventar`, without a single price (KI-0's rule 9) and without the page's
 * default write: `defineTool` refuses every role but Admin and Büro first.
 */
export const artikelFinden = defineTool({
  name: 'artikel_finden',
  label: 'Artikel finden',
  description:
    'Findet Artikel im Lager nach Name, Nummer, Hersteller oder Barcode. Gibt höchstens 10 Artikel mit Einheit, Bestand, verfügbarer Menge und Lieferantenartikelnummern samt Packungsgrößen zurück, ohne Preise.',
  input: z.strictObject({
    suche: z.string().trim().min(1).max(100).describe('Name, Artikelnummer, Hersteller oder Barcode'),
  }),
  roles: ['admin', 'buero'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['article'],
  writesMemory: false,
  async execute(input, ctx) {
    const query = inventoryPageQuerySchema.parse({ search: input.suche });
    const overview = await readInventoryOverview(createSupabaseAdminClient(), ctx.orgId, query);
    if (overview === 'inventory_failed' || overview.articleTerms.status === 'failed')
      return { status: 'failed' };
    const { byItem } = overview.articleTerms;
    const suppliers = new Map(overview.suppliers.map((supplier) => [supplier.id, supplier.name]));
    const artikel = overview.items.slice(0, RESULT_LIMIT).map((item) => ({
      name: record(item.name),
      nummer: record(item.internalSku),
      hersteller: record(item.manufacturer),
      einheit: record(item.unit),
      bestand: item.totalOnHand,
      verfuegbar: item.availableQuantity,
      lieferanten: (byItem[item.id]?.suppliers ?? []).map((reference) => ({
        lieferant: record(suppliers.get(reference.supplierId) ?? null),
        artikelnummer: record(reference.supplierArticleNumber),
        bestelleinheit: record(reference.purchaseUnit ?? item.unit),
        packungsmenge: reference.packQuantity,
        basismenge: reference.baseQuantity,
      })),
    }));
    return { status: 'ok', value: { artikel, gesamt: overview.page.total } };
  },
});
