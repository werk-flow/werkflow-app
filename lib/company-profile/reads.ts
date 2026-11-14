import 'server-only';

import type { ActionContext } from '@/lib/org/action-context';
import { loggedRead } from '@/lib/data/read-request-cache';
import { bindUploadPathToCreator } from '@/lib/documents/storage-path';
import type { StationeryFile } from '@/lib/document-rendering/model';
import { readStorageObject } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import type { ActionFailure } from '@/lib/action-result';

import { offerLetterhead, type LetterheadFiles, type OfferLetterhead } from './letterhead';
import {
  COMPANY_FILE_KINDS,
  EMPTY_COMPANY_PROFILE_DETAILS,
  type CompanyDocumentProfile,
  type CompanyFileKind,
} from './profile';

// Server reads of the company document profile. The table grants no client
// role anything; these run with the service role after the caller's manager
// check and filter by the caller's organization.

type ProfileRow = Database['public']['Tables']['company_document_profiles']['Row'];

/** A stored file as the server keeps it: its key and its type. */
type StoredFilePath = { path: string; mimeType: string };

type StoredProfile = {
  profile: CompanyDocumentProfile;
  filePaths: Record<CompanyFileKind, StoredFilePath | null>;
};

/**
 * The key of one logo or stationery upload, bound to the organization and
 * person of the session that signs or finalizes it; it holds no file name.
 * Ticket and finalize both build it from the session, so another person who
 * knows the file id finds no staged object there.
 */
export function companyFilePath(context: ActionContext, fileId: string, kind: CompanyFileKind): string {
  return bindUploadPathToCreator(`${context.orgId}/briefpapier/${fileId}/${kind}`, context.userId);
}

function storedFile(path: string | null, mimeType: string | null): StoredFilePath | null {
  return path !== null && mimeType !== null ? { path, mimeType } : null;
}

function profileOf(row: ProfileRow | null): StoredProfile {
  const filePaths = {
    logo: storedFile(row?.logo_storage_path ?? null, row?.logo_mime_type ?? null),
    stationery_first: storedFile(
      row?.stationery_first_storage_path ?? null,
      row?.stationery_first_mime_type ?? null,
    ),
    stationery_following: storedFile(
      row?.stationery_following_storage_path ?? null,
      row?.stationery_following_mime_type ?? null,
    ),
  };
  const shown = (file: StoredFilePath | null) => file && { storagePath: file.path, mimeType: file.mimeType };
  const files = {
    logo: shown(filePaths.logo),
    stationery_first: shown(filePaths.stationery_first),
    stationery_following: shown(filePaths.stationery_following),
  };
  if (!row) {
    return {
      profile: { version: 0, updatedAt: null, details: EMPTY_COMPANY_PROFILE_DETAILS, files },
      filePaths,
    };
  }
  return {
    filePaths,
    profile: {
      version: row.version,
      updatedAt: row.updated_at,
      files,
      details: {
        companyName: row.company_name,
        street: row.street,
        postalCode: row.postal_code,
        city: row.city,
        phone: row.phone,
        email: row.email,
        website: row.website,
        registerCourt: row.register_court,
        registerNumber: row.register_number,
        managingDirectors: row.managing_directors,
        taxNumber: row.tax_number,
        vatId: row.vat_id,
        bankName: row.bank_name,
        iban: row.iban,
        bic: row.bic,
        offerOpeningText: row.offer_opening_text,
        offerClosingText: row.offer_closing_text,
        offerValidityDays: row.offer_validity_days,
        standardTaxRateBasisPoints: row.standard_tax_rate_basis_points,
        firstPageMargins: {
          topMm: row.stationery_first_top_mm,
          rightMm: row.stationery_first_right_mm,
          bottomMm: row.stationery_first_bottom_mm,
          leftMm: row.stationery_first_left_mm,
        },
        followingPageMargins: {
          topMm: row.stationery_following_top_mm,
          rightMm: row.stationery_following_right_mm,
          bottomMm: row.stationery_following_bottom_mm,
          leftMm: row.stationery_following_left_mm,
        },
      },
    },
  };
}

/**
 * The profile of the caller's organization, for an Admin or Büro caller. An
 * organization that saved none reads the empty profile at version 0.
 */
export async function readCompanyProfile(
  admin: AdminClient,
  caller: Pick<ActionContext, 'orgId' | 'isManagerOrAbove'>,
): Promise<({ success: true } & StoredProfile) | ActionFailure<'not_authorized' | 'load_failed'>> {
  if (!caller.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { data, error } = await loggedRead(
    'readCompanyProfile: profile read failed',
    admin.from('company_document_profiles').select('*').eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (error) return { success: false, error: 'load_failed' };
  return { success: true, ...profileOf(data) };
}

function fileOf(mimeType: string, bytes: Uint8Array): StationeryFile {
  if (mimeType === 'application/pdf') return { format: 'pdf', bytes };
  return { format: mimeType === 'image/png' ? 'png' : 'jpeg', bytes };
}

/** The stored file's bytes in the renderer's shape. */
export async function readCompanyFile(organizationId: string, file: StoredFilePath): Promise<StationeryFile> {
  return fileOf(file.mimeType, await readStorageObject({ organizationId, path: file.path }));
}

/** The bytes of every stored logo and stationery page; a missing object throws. */
async function readLetterheadFiles(
  organizationId: string,
  filePaths: StoredProfile['filePaths'],
): Promise<LetterheadFiles> {
  const entries = await Promise.all(
    COMPANY_FILE_KINDS.map(async (kind) => {
      const file = filePaths[kind];
      return file ? ([kind, await readCompanyFile(organizationId, file)] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

/**
 * The letterhead a generated offer of the caller's organization takes from its
 * profile, files included; a missing stored file throws.
 */
export async function readOfferLetterhead(
  admin: AdminClient,
  caller: Pick<ActionContext, 'orgId' | 'isManagerOrAbove'>,
  organizationName: string,
): Promise<{ success: true; letterhead: OfferLetterhead } | ActionFailure<'not_authorized' | 'load_failed'>> {
  const stored = await readCompanyProfile(admin, caller);
  if (!stored.success) return stored;
  const files = await readLetterheadFiles(caller.orgId, stored.filePaths);
  return { success: true, letterhead: offerLetterhead(stored.profile.details, files, organizationName) };
}
