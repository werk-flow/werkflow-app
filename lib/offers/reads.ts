import 'server-only';

import { formatSiteAddress } from '@/lib/clients/types';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { positionCostSchema, storedSectionSchema } from './action-schemas';
import type { OfferListQuery, OfferPage } from './list-page';
import {
  OFFER_STATUSES,
  offerWorkKindSchema,
  type OfferDetail,
  type OfferWithCosts,
  type OfferWorkKind,
} from './types';

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
  version: z.number().int().positive(),
  contentVersion: z.number().int().positive(),
  validUntil: z.iso.date(),
  openingText: z.string(),
  closingText: z.string(),
  client: party,
  site: party
    .extend({ street: z.string().nullable(), postalCode: z.string().nullable(), city: z.string().nullable() })
    .nullable(),
  contact: party.nullable(),
  recipient: party.extend({ address: z.string().nullable(), isDefault: z.boolean() }),
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
  sections: z.array(storedSectionSchema),
});

const WORK_LABELS: Record<OfferWorkKind, string> = { job: 'Auftrag', project: 'Projekt', request: 'Anfrage' };

/** The offer `get_offer` answered, with the names its header shows and no cost. Throws on a malformed answer. */
function offerDetailOf(data: unknown): OfferDetail {
  const parsed = offerSchema.safeParse(data);
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

const offerWithCostsSchema = z.object({
  offer: z.unknown(),
  costs: z.array(z.array(positionCostSchema.nullable())),
});

/**
 * One offer of the organization as the office's page reads it: its header
 * with the names it shows, its content, and each priced Position's cost,
 * read in one statement with the content. The caller has established Admin
 * or Büro; `null` when there is no such offer.
 */
export async function readOfferWithCosts(
  organizationId: string,
  offerId: string,
): Promise<OfferWithCosts | null> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('get_offer_with_costs', {
    p_organization_id: organizationId,
    p_offer_id: offerId,
  });
  if (selected.error) throw new Error('offer_read_failed');
  if (selected.data === null) return null;
  const parsed = offerWithCostsSchema.safeParse(selected.data);
  if (!parsed.success) throw new Error('offer_read_failed');
  const offer = offerDetailOf(parsed.data.offer);
  const { costs } = parsed.data;
  return {
    ...offer,
    sections: offer.sections.map((section, sectionIndex) => ({
      ...section,
      positions: section.positions.map((position, positionIndex) => {
        if (position.kind === 'text') return position;
        const cost = costs[sectionIndex]?.[positionIndex];
        // Both answers come from one statement: a missing entry is a broken read, never a cost of zero.
        if (cost === undefined) throw new Error('offer_read_failed');
        return { ...position, cost };
      }),
    })),
  };
}
