import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { offerLetterhead } from '@/lib/company-profile/letterhead';
import type { CompanyFileKind, CompanyProfileDetails } from '@/lib/company-profile/profile';
import { readCompanyProfile, readLetterheadFiles } from '@/lib/company-profile/reads';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getCachedMemberships } from '@/lib/data/cached';
import { renderBusinessDocument } from '@/lib/document-rendering/render';
import { buildDocumentStoragePath } from '@/lib/documents/storage-path';
import { logError } from '@/lib/logging';
import type { StoredOriginal } from '@/lib/invoices/original';
import type { ActionContext } from '@/lib/org/action-context';
import { discardStorageObjects, putStorageObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { sendOfferSchema, type SendOfferInput } from './action-schemas';
import { offerDocument } from './document';
import { readOffer, readOfferRevisions } from './reads';
import type { OfferDetail } from './types';

// „Als gesendet festhalten“ (supabase/migrations/20270601090000_send_an_offer_and_keep_each_sent_revision.sql).
// The server renders the saved draft with the company profile, as the
// preview does, stores the PDF under a new document id, and send_offer
// freezes the revision, registers and files that PDF and sets „Gesendet“ in
// one call. A refused call or a replay that names another document discards
// the stored bytes; after an unknown outcome they stay, as the call may have
// committed. WerkFlow sends nothing: the channel is what the office used.

type OfficeContext = Pick<ActionContext, 'orgId' | 'userId' | 'isManagerOrAbove'>;

/**
 * What the PDF printed beyond the revision's own columns, stored with it: the
 * sender's profile with its letterhead files, the customer, the Einsatzort
 * and the texts.
 */
type RenderedSnapshot = {
  organizationName: string;
  profile: CompanyProfileDetails;
  files: Record<CompanyFileKind, { path: string; mimeType: string } | null>;
  clientName: string;
  site: { name: string; address: string } | null;
  openingText: string;
  closingText: string;
};

type RenderedOffer = { bytes: Uint8Array; revision: number; snapshot: RenderedSnapshot };

/**
 * The draft as the PDF its customer would get on `issuedOn`, as its next
 * revision, with the organization's company profile. Null when the profile or
 * its files cannot be read; a head or a Position the renderer refuses throws a
 * RangeError.
 */
export async function renderOfferPdf(
  context: OfficeContext,
  offer: OfferDetail,
  issuedOn: string,
): Promise<RenderedOffer | null> {
  const admin = createSupabaseAdminClient();
  const [stored, memberships, revisions] = await Promise.all([
    readCompanyProfile(admin, context),
    getCachedMemberships(context.userId),
    readOfferRevisions(context.orgId, offer.id),
  ]);
  const organization = memberships.find((membership) => membership.orgId === context.orgId);
  if (!stored.success || !organization) return null;
  const files = await readLetterheadFiles(context.orgId, stored.filePaths);
  const letterhead = offerLetterhead(stored.profile.details, files, organization.name);
  const revision = revisions.length + 1;
  const bytes = await renderBusinessDocument(offerDocument(offer, letterhead, { issuedOn, revision }));
  return {
    bytes,
    revision,
    snapshot: {
      organizationName: organization.name,
      profile: stored.profile.details,
      files: stored.filePaths,
      clientName: offer.client.name,
      site: offer.site && { name: offer.site.name, address: offer.site.address },
      openingText: offer.openingText,
      closingText: offer.closingText,
    },
  };
}

function contentHashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A stored PDF not yet registered, as an invoice original is. */
type StoredPdf = StoredOriginal;

async function storeOfferPdf(
  organizationId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<StoredPdf> {
  const documentId = randomUUID();
  const path = buildDocumentStoragePath({ organizationId, documentId, fileName });
  await putStorageObject({ organizationId, path, body: bytes, contentType: 'application/pdf' });
  return { documentId, path, fileName, sizeBytes: bytes.byteLength, contentHash: contentHashOf(bytes) };
}

const refusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'offer_not_found',
    'offer_not_editable',
    'offer_changed',
    'offer_empty',
    'offer_expired',
  ]),
);

const sentSchema = z.object({
  revision: z.number().int().positive(),
  documentId: uuidSchema,
  replay: z.boolean(),
});

export type OfferSent = { offerId: string; revision: number; documentId: string };

/**
 * Records the saved draft as sent through the channel the office names, for
 * the office's action and for a server caller that sends for the office, such
 * as E2c's email delivery. The caller has established the actor as Admin or
 * Büro of the organization and names the SHA-256 of the PDF it showed or sent
 * (renderOfferPdf); a rendering that differs is refused with
 * `preview_outdated`. A repeat under the same attempt key, or of the same
 * draft, answers the first revision.
 */
export async function recordOfferSent(
  context: OfficeContext,
  rawInput: SendOfferInput,
): Promise<ActionResult<OfferSent>> {
  const parsed = sendOfferSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const offer = await readOffer(context.orgId, input.offerId);
  if (!offer) return { success: false, error: 'offer_not_found' };
  if (offer.status !== 'entwurf') return sendRendered(context, input, offer, null);
  if (offer.version !== input.expectedVersion || offer.contentVersion !== input.expectedContentVersion) {
    return { success: false, error: 'offer_changed' };
  }
  const issuedOn = getBusinessTodayIso();
  const rendered = await renderOfferPdf(context, offer, issuedOn).catch((error: unknown) => {
    logError('recordOfferSent: render failed', error);
    return null;
  });
  if (!rendered) return { success: false, error: 'render_failed' };
  // Only the PDF the office saw is filed: a changed customer, profile or day renders other bytes.
  if (contentHashOf(rendered.bytes) !== input.previewHash) {
    // Another send of this draft may have committed between the reads: it answers its revision.
    const now = await readOffer(context.orgId, input.offerId);
    if (now && now.status !== 'entwurf') return sendRendered(context, input, now, null);
    return { success: false, error: 'preview_outdated' };
  }
  const fileName = `Angebot ${offer.offerNumber} Revision ${rendered.revision}.pdf`;
  const stored = await storeOfferPdf(context.orgId, fileName, rendered.bytes).catch((error: unknown) => {
    logError('recordOfferSent: PDF not stored', error);
    return null;
  });
  if (!stored) return { success: false, error: 'save_failed' };
  return sendRendered(context, input, offer, { stored, issuedOn, snapshot: rendered.snapshot });
}

/** The one send_offer call; without a rendering it can only answer a repeat or refuse. */
async function sendRendered(
  context: OfficeContext,
  input: z.output<typeof sendOfferSchema>,
  offer: OfferDetail,
  rendered: { stored: StoredPdf; issuedOn: string; snapshot: RenderedSnapshot } | null,
): Promise<ActionResult<OfferSent> | ActionFailure> {
  const stored = rendered?.stored ?? null;
  const { data, error } = await createSupabaseAdminClient().rpc('send_offer', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_offer_id: offer.id,
    p_expected_version: input.expectedVersion,
    p_expected_content_version: input.expectedContentVersion,
    p_attempt_key: input.attemptKey,
    p_channel: input.channel,
    p_sent_on: rendered?.issuedOn ?? getBusinessTodayIso(),
    p_recipient_name: offer.recipient.name,
    p_recipient_address: offer.recipient.address ?? '',
    p_snapshot: toJson(rendered?.snapshot ?? {}),
    ...(stored && {
      p_document_id: stored.documentId,
      p_storage_path: stored.path,
      p_file_name: stored.fileName,
      p_size_bytes: stored.sizeBytes,
      p_content_hash: stored.contentHash,
    }),
  });
  const sent = sentSchema.safeParse(data);
  // Refused, or another send registered its PDF first: nothing references this object.
  if (
    stored &&
    (isConfirmedWriteRefusal(error) || (sent.success && sent.data.documentId !== stored.documentId))
  ) {
    await discardStorageObjects({ organizationId: context.orgId, paths: [stored.path] });
  }
  if (error || !sent.success) return refusal(error, 'save_failed', 'recordOfferSent: send_offer failed');
  return { success: true, offerId: offer.id, revision: sent.data.revision, documentId: sent.data.documentId };
}
