import 'server-only';

import { isInventoryUnitCode } from '@/lib/inventory/units';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { LeistungListQuery, LeistungPage } from './list-page';
import { leistungKindSchema, type LeistungListEntry, type LeistungPriceVersion } from './types';

const cents = z.number().int().nonnegative();
const leistungPageSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  rows: z
    .array(
      z.object({
        id: uuidSchema,
        leistungNumber: z.string(),
        name: z.string(),
        description: z.string(),
        kind: leistungKindSchema,
        unit: z.string(),
        taxRateBasisPoints: z.number().int(),
        archivedAt: z.string().nullable(),
        priceVersionId: uuidSchema.nullable(),
        nextValidFrom: z.iso.date().nullable(),
        versions: z.array(
          z.object({
            id: uuidSchema,
            validFrom: z.iso.date(),
            salePriceCents: cents,
            costRateCents: cents.nullable(),
            recordedAt: z.string(),
          }),
        ),
      }),
    )
    .max(LIST_PAGE_SIZE),
});

type VersionRow = z.infer<typeof leistungPageSchema>['rows'][number]['versions'][number];

/**
 * The versions in the database's order (latest first day first, the latest
 * recording first within a day): only the first of each day still answers.
 */
function toVersions(rows: readonly VersionRow[]): LeistungPriceVersion[] {
  const answeredDays = new Set<string>();
  return rows.map((row) => {
    const superseded = answeredDays.has(row.validFrom);
    answeredDays.add(row.validFrom);
    return { ...row, superseded };
  });
}

/**
 * One page of the Leistungen with their prices on `priceDate`. Internal
 * reader: the page authorizes the current manager and resolves the
 * organization before it calls this. A failed or malformed read throws; it
 * never becomes an empty list.
 */
export async function readLeistungPage(
  organizationId: string,
  query: LeistungListQuery,
  priceDate: string,
): Promise<LeistungPage> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_leistung_page', {
    p_organization_id: organizationId,
    p_on_date: priceDate,
    p_view: query.view,
    p_search: query.search,
    p_page: query.page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const parsed = leistungPageSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('leistung_page_read_failed');
  return {
    total: parsed.data.total,
    hasAnyLeistung: parsed.data.hasAny,
    priceDate,
    entries: parsed.data.rows.map(
      (row): LeistungListEntry => ({
        id: row.id,
        leistungNumber: row.leistungNumber,
        name: row.name,
        description: row.description,
        kind: row.kind,
        unit: isInventoryUnitCode(row.unit) ? row.unit : null,
        taxRateBasisPoints: row.taxRateBasisPoints,
        archived: row.archivedAt !== null,
        currentVersionId: row.priceVersionId,
        nextValidFrom: row.nextValidFrom,
        versions: toVersions(row.versions),
      }),
    ),
  };
}
