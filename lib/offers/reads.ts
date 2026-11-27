import 'server-only';

import { formatSiteAddress } from '@/lib/clients/types';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { signPriceSource } from '@/lib/price-catalog/price-source-proof';
import { positionCostSchema, storedSectionSchema } from './action-schemas';
import type { OfferListQuery, OfferPage } from './list-page';
import {
  OFFER_CHANNELS,
  OFFER_STATUSES,
  offerWorkKindSchema,
  type OfferDetail,
  type OfferFreePosition,
  type OfferPriceSource,
  type OfferRevision,
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

const priceSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listenpreis'), condition: z.null() }),
  z.object({
    kind: z.literal('kundenkondition'),
    condition: z.object({ id: uuidSchema, version: z.number().int().positive(), validFrom: z.iso.date() }),
  }),
  z.object({ kind: z.literal('manuell'), condition: z.null() }),
]);
/**
 * One offer of the organization with the names its header shows and no cost:
 * the read for its document (preview and send), which must never carry a
 * cost or margin. `null` when there is none.
 */
export async function readOffer(organizationId: string, offerId: string): Promise<OfferDetail | null> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('get_offer', { p_organization_id: organizationId, p_offer_id: offerId });
  if (selected.error) throw new Error('offer_read_failed');
  if (selected.data === null) return null;
  return offerDetailOf(selected.data);
}

const offerWithCostsSchema = z.object({
  offer: z.unknown(),
  costs: z.array(z.array(positionCostSchema.nullable())),
  priceSources: z.array(z.array(priceSourceSchema.nullable())),
});

/**
 * A stored price source as the editor holds it, signed again for this
 * Position's entry and price, so the next save keeps it while the Position
 * does. A Position saved before sources were kept reads as „manuell“.
 */
function priceSourceOf(
  stored: z.infer<typeof priceSourceSchema> | null,
  position: Pick<OfferFreePosition, 'source' | 'unit' | 'unitPriceCents' | 'priceQuantity'>,
  scope: { organizationId: string; offerId: string },
): OfferPriceSource {
  if (!stored || stored.kind === 'manuell' || !position.source) return { kind: 'manuell' };
  const proof = signPriceSource({
    ...scope,
    entry: { kind: position.source.kind, id: position.source.id },
    kind: stored.kind,
    conditionId: stored.condition?.id ?? null,
    unit: position.unit,
    unitPriceCents: position.unitPriceCents,
    priceQuantity: position.priceQuantity,
  });
  return stored.kind === 'listenpreis'
    ? { kind: 'listenpreis', proof }
    : { kind: 'kundenkondition', condition: stored.condition, proof };
}

/**
 * One offer of the organization as the office's page reads it: its header
 * with the names it shows, its content, and each priced Position's cost and
 * price source, read in one statement with the content. The caller has established Admin
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
  const { costs, priceSources } = parsed.data;
  return {
    ...offer,
    sections: offer.sections.map((section, sectionIndex) => ({
      ...section,
      positions: section.positions.map((position, positionIndex) => {
        if (position.kind === 'text') return position;
        const cost = costs[sectionIndex]?.[positionIndex];
        const priceSource = priceSources[sectionIndex]?.[positionIndex];
        // The answers come from one statement: a missing entry is a broken read, never a cost of zero.
        if (cost === undefined || priceSource === undefined) throw new Error('offer_read_failed');
        return {
          ...position,
          cost,
          priceSource: priceSourceOf(priceSource, position, { organizationId, offerId }),
        };
      }),
    })),
  };
}

const revisionsSchema = z.array(
  z.object({
    revision: z.number().int().positive(),
    sentOn: z.iso.date(),
    channel: z.enum(OFFER_CHANNELS),
    validUntil: z.iso.date(),
    grossCents: z.number().int(),
    recipientName: z.string(),
    documentId: uuidSchema,
    sentBy: z
      .object({
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        email: z.string().nullable(),
      })
      .nullable(),
  }),
);

/** The sent revisions of one offer of the organization, newest first; none for an offer never sent. */
export async function readOfferRevisions(organizationId: string, offerId: string): Promise<OfferRevision[]> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_offer_revisions', {
    p_organization_id: organizationId,
    p_offer_id: offerId,
  });
  const parsed = revisionsSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('offer_revisions_read_failed');
  return parsed.data.map(({ sentBy, ...revision }) => ({
    ...revision,
    sentBy: sentBy
      ? formatProfileName({ first_name: sentBy.firstName, last_name: sentBy.lastName, email: sentBy.email })
      : null,
  }));
}
