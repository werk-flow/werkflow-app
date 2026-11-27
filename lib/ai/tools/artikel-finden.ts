import 'server-only';

import { recordText } from '@/lib/ai/context';
import { defineTool } from '@/lib/ai/tools/define-tool';
import { inventoryPageQuerySchema } from '@/lib/inventory/list-page';
import { readInventoryOverview } from '@/lib/inventory/overview-read';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

/** The articles one call returns, of the page's first 50. */
const RESULT_LIMIT = 10;

/**
 * Articles with their stock and supplier references through the reader of
 * `/inventar`, without a single price (KI-0's rule 9) and without the page's
 * default write: `defineTool` refuses every role but Admin and Büro first.
 */
export const artikelFinden = defineTool({
  name: 'artikel_finden',
  label: 'Artikel finden',
  description:
    'Findet Artikel im Lager nach Name, Nummer, Hersteller oder Barcode. Gibt höchstens 10 Artikel mit Einheit, Bestand, verfügbarer Menge und Lieferantenartikelnummern samt Packungsgrößen zurück, ohne Preise. Lieferanten ist null, wenn sie nicht gelesen werden konnten.',
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
    if (overview === 'inventory_failed') return { status: 'failed' };
    // Like the page, the list stands when the supplier terms fail: `lieferanten` is then unknown.
    const terms = overview.articleTerms.status === 'loaded' ? overview.articleTerms.byItem : null;
    const suppliers = new Map(overview.suppliers.map((supplier) => [supplier.id, supplier.name]));
    const artikel = overview.items.slice(0, RESULT_LIMIT).map((item) => ({
      name: recordText(item.name),
      nummer: recordText(item.internalSku),
      hersteller: recordText(item.manufacturer),
      einheit: recordText(item.unit),
      bestand: item.totalOnHand,
      verfuegbar: item.availableQuantity,
      lieferanten:
        terms &&
        (terms[item.id]?.suppliers ?? []).map((reference) => ({
          lieferant: recordText(suppliers.get(reference.supplierId) ?? null),
          artikelnummer: recordText(reference.supplierArticleNumber),
          bestelleinheit: recordText(reference.purchaseUnit ?? item.unit),
          packungsmenge: reference.packQuantity,
          basismenge: reference.baseQuantity,
        })),
    }));
    return { status: 'ok', value: { artikel, gesamt: overview.page.total } };
  },
});
