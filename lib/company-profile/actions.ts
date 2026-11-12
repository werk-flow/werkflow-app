'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { canEmbedFile, stationeryMarginsFit } from '@/lib/document-rendering/render';
import { logError } from '@/lib/logging';
import { resolveActionContextFor, type ActionContext } from '@/lib/org/action-context';
import { createSignedUploadUrl, discardStorageObjects, promoteUploadedObject } from '@/lib/storage/r2';
import { uploadRuleFailure } from '@/lib/storage/upload-rules';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';

import {
  COMPANY_FILE_RULES,
  companyFileFinalizeInputSchema,
  companyFileRemoveInputSchema,
  companyFileTicketInputSchema,
  saveCompanyProfileInputSchema,
  type CompanyFileFinalizeInput,
  type CompanyFileRemoveInput,
  type CompanyFileTicketInput,
  type CompanyFileTicketResult,
  type SaveCompanyProfileInput,
  type SaveCompanyProfileResult,
} from './profile';
import { companyFilePath, readCompanyFile } from './reads';

// The writes of the company document profile (werk-flow/werkflow-planning#378).
// Admin and Büro of the named organization only. The details save in one
// database call with their history. Logo and stationery follow the upload
// flow of docs/technical/document-storage-and-access.md: the ticket signs a
// PUT for a staging key, the browser moves the bytes, and the finalize copies
// them to a key of its own, checks that the renderer embeds them, and
// registers the copy in one database call. No byte passes through an action.

const SETTINGS_PATH = '/einstellungen/dokumente';
const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;
const refusal = writeRefusalFor(
  new Set(['not_authorized', 'profile_changed', 'no_changes', 'stationery_first_missing']),
);

async function resolveManager(
  organizationId: string,
): Promise<
  | { success: true; context: ActionContext }
  | ActionFailure<'not_authenticated' | 'not_a_member' | 'not_authorized'>
> {
  const auth = await resolveActionContextFor(organizationId);
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return auth;
}

/** Saves the details and offer defaults; answers the new version. */
export async function saveCompanyDocumentProfile(
  rawInput: SaveCompanyProfileInput,
): Promise<SaveCompanyProfileResult> {
  const parsed = saveCompanyProfileInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveManager(input.organizationId);
  if (!auth.success) return auth;
  const { details } = input;
  if (
    !stationeryMarginsFit({
      firstPage: details.firstPageMargins,
      followingPages: details.followingPageMargins,
    })
  ) {
    return { success: false, error: 'margins_leave_no_room' };
  }

  const { data, error } = await createSupabaseAdminClient().rpc(
    'save_company_document_profile',
    rpcArgs('save_company_document_profile', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_expected_version: input.expectedVersion,
      p_values: {
        company_name: details.companyName,
        street: details.street,
        postal_code: details.postalCode,
        city: details.city,
        phone: details.phone,
        email: details.email,
        website: details.website,
        register_court: details.registerCourt,
        register_number: details.registerNumber,
        managing_directors: details.managingDirectors,
        tax_number: details.taxNumber,
        vat_id: details.vatId,
        bank_name: details.bankName,
        iban: details.iban,
        bic: details.bic,
        offer_opening_text: details.offerOpeningText,
        offer_closing_text: details.offerClosingText,
        offer_validity_days: details.offerValidityDays,
        standard_tax_rate_basis_points: details.standardTaxRateBasisPoints,
        stationery_first_top_mm: details.firstPageMargins.topMm,
        stationery_first_right_mm: details.firstPageMargins.rightMm,
        stationery_first_bottom_mm: details.firstPageMargins.bottomMm,
        stationery_first_left_mm: details.firstPageMargins.leftMm,
        stationery_following_top_mm: details.followingPageMargins.topMm,
        stationery_following_right_mm: details.followingPageMargins.rightMm,
        stationery_following_bottom_mm: details.followingPageMargins.bottomMm,
        stationery_following_left_mm: details.followingPageMargins.leftMm,
      },
    }),
  );
  if (error || data === null) {
    return refusal(error, 'save_failed', 'saveCompanyDocumentProfile: save failed');
  }
  revalidatePath(SETTINGS_PATH);
  return { success: true, version: data };
}

/** Signs the browser's upload of a logo or stationery page. */
export async function createCompanyDocumentFileUploadTicket(
  rawInput: CompanyFileTicketInput,
): Promise<CompanyFileTicketResult> {
  const parsed = companyFileTicketInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveManager(input.organizationId);
  if (!auth.success) return auth;
  const ruleFailure = uploadRuleFailure(COMPANY_FILE_RULES[input.kind], input.mimeType, input.fileSizeBytes);
  if (ruleFailure) return { success: false, error: ruleFailure };

  const fileId = randomUUID();
  try {
    const uploadUrl = await createSignedUploadUrl({
      organizationId: auth.context.orgId,
      path: companyFilePath(auth.context.orgId, fileId, input.kind),
      contentType: input.mimeType,
    });
    return { success: true, ticket: { fileId, uploadUrl } };
  } catch (error) {
    logError('createCompanyDocumentFileUploadTicket: signing failed', error);
    return { success: false, error: 'ticket_failed' };
  }
}

/** Checks the uploaded file and makes it the profile's logo or stationery page. */
export async function finalizeCompanyDocumentFileUpload(
  rawInput: CompanyFileFinalizeInput,
): Promise<ActionResult> {
  const parsed = companyFileFinalizeInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveManager(input.organizationId);
  if (!auth.success) return auth;
  const organizationId = auth.context.orgId;
  // The key is recomputed from the authorized organization, so no client
  // names an object of another organization.
  const path = companyFilePath(organizationId, input.fileId, input.kind);

  let copy;
  try {
    copy = await promoteUploadedObject({ organizationId, path });
  } catch (error) {
    logError('finalizeCompanyDocumentFileUpload: promotion failed', error);
    return { success: false, error: 'upload_failed' };
  }
  if (!copy.exists) return { success: false, error: 'file_missing' };
  const discardCopy = () => discardStorageObjects({ organizationId, paths: [copy.path] });
  const ruleFailure = uploadRuleFailure(COMPANY_FILE_RULES[input.kind], copy.contentType, copy.sizeBytes);
  if (ruleFailure || copy.contentType === null) {
    await discardCopy();
    return { success: false, error: ruleFailure ?? 'file_type_not_allowed' };
  }
  const mimeType = copy.contentType;
  try {
    const file = await readCompanyFile(organizationId, { path: copy.path, mimeType });
    if (!(await canEmbedFile(file, input.kind === 'logo' ? 'image' : 'page'))) {
      await discardCopy();
      return { success: false, error: 'file_unreadable' };
    }
  } catch (error) {
    logError('finalizeCompanyDocumentFileUpload: stored copy read failed', error);
    await discardCopy();
    return { success: false, error: 'upload_failed' };
  }

  const { error } = await createSupabaseAdminClient().rpc(
    'replace_company_document_file',
    rpcArgs('replace_company_document_file', {
      p_actor_id: auth.context.userId,
      p_organization_id: organizationId,
      p_kind: input.kind,
      p_storage_path: copy.path,
      p_mime_type: mimeType,
    }),
  );
  if (error) {
    // After an unknown outcome the copy stays: the registration may still commit.
    if (isConfirmedWriteRefusal(error)) await discardCopy();
    return refusal(error, 'finalize_failed', 'finalizeCompanyDocumentFileUpload: registration failed');
  }
  revalidatePath(SETTINGS_PATH);
  return { success: true };
}

/** Removes the logo or a stationery page; removing the first page's removes the following pages' too. */
export async function removeCompanyDocumentFile(rawInput: CompanyFileRemoveInput): Promise<ActionResult> {
  const parsed = companyFileRemoveInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveManager(input.organizationId);
  if (!auth.success) return auth;

  const { error } = await createSupabaseAdminClient().rpc(
    'replace_company_document_file',
    rpcArgs('replace_company_document_file', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_kind: input.kind,
      p_storage_path: null,
      p_mime_type: null,
    }),
  );
  if (error) return refusal(error, 'remove_failed', 'removeCompanyDocumentFile: removal failed');
  revalidatePath(SETTINGS_PATH);
  return { success: true };
}
