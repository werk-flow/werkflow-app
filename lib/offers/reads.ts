import 'server-only';

import { formatSiteAddress } from '@/lib/clients/types';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { OfferListQuery, OfferPage } from './list-page';
import { OFFER_STATUSES, offerWorkKindSchema, type OfferDetail, type OfferWorkKind } from './types';

// Internal readers: the page authorizes the current manager and resolves the
// organization before it calls one. A failed or malformed read throws; it
// never becomes an empty list or a missing offer.

const offerPageSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  rows: z
    .array(
      z.object({
        id: uuidSchema,
        offerNumber: z.string(),
        title: z.string(),
        status: z.string(),
        clientId: uuidSchema,
        clientName: z.string(),
        recipientName: z.string().nullable(),
        validUntil: z.iso.date(),
      }),
    )
    .max(LIST_PAGE_SIZE),
});

/** One page of the organization's offers, or of one customer's, newest first. */
export async function readOfferPage(
  organizationId: string,
  query: OfferListQuery,
  pageSize: number = LIST_PAGE_SIZE,
): Promise<OfferPage> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_offer_page', {
    p_organization_id: organizationId,
    ...(query.status ? { p_status: query.status } : {}),
    p_search: query.search,
    ...(query.clientId ? { p_client_id: query.clientId } : {}),
    p_page: query.page,
    p_page_size: pageSize,
  });
  const parsed = offerPageSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('offer_page_read_failed');
  return {
    total: parsed.data.total,
    hasAnyOffer: parsed.data.hasAny,
    entries: parsed.data.rows.map((row) => ({
      ...row,
      status: constrainedValue(OFFER_STATUSES, row.status, 'offers.status'),
    })),
  };
}

const party = z.object({ id: uuidSchema, name: z.string() });
const offerSchema = z.object({
  id: uuidSchema,
  offerNumber: z.string(),
  title: z.string(),
  status: z.string(),
  validUntil: z.iso.date(),
  openingText: z.string(),
  closingText: z.string(),
  client: party,
  site: party.extend({ street: z.string(), postalCode: z.string(), city: z.string() }).nullable(),
  contact: party.nullable(),
  recipient: party.extend({ address: z.string().nullable() }),
  owner: z
    .object({
      userId: uuidSchema,
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
  work: z
    .object({ kind: offerWorkKindSchema, id: uuidSchema, number: z.string().nullable(), title: z.string() })
    .nullable(),
});

const WORK_LABELS: Record<OfferWorkKind, string> = { job: 'Auftrag', project: 'Projekt', request: 'Anfrage' };

/** One offer of the organization with the names its header shows; `null` when there is none. */
export async function readOffer(organizationId: string, offerId: string): Promise<OfferDetail | null> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('get_offer', { p_organization_id: organizationId, p_offer_id: offerId });
  if (selected.error) throw new Error('offer_read_failed');
  if (selected.data === null) return null;
  const parsed = offerSchema.safeParse(selected.data);
  if (!parsed.success) throw new Error('offer_read_failed');
  const { site, owner, work, ...offer } = parsed.data;
  return {
    ...offer,
    status: constrainedValue(OFFER_STATUSES, offer.status, 'offers.status'),
    site: site ? { id: site.id, name: site.name, address: formatSiteAddress(site) } : null,
    owner: owner
      ? {
          userId: owner.userId,
          name: formatProfileName({
            first_name: owner.firstName,
            last_name: owner.lastName,
            email: owner.email,
          }),
        }
      : null,
    work: work
      ? {
          kind: work.kind,
          id: work.id,
          label: `${WORK_LABELS[work.kind]} ${[work.number, work.title].filter(Boolean).join(' · ')}`,
        }
      : null,
  };
}
