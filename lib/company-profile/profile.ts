import { z } from '@/lib/zod';

import type { ActionResult } from '@/lib/action-result';
import { uuidSchema } from '@/lib/validation/uuid';

// The company document profile (werk-flow/werkflow-planning#378): the
// details every generated business document carries, the defaults of a new
// offer, and which logo and stationery files are stored. The limits are the
// check constraints of 20261201130000_keep_one_company_document_profile.sql.

const shortText = (maxLength: number) => z.string().trim().max(maxLength);
const marginSchema = (maximum: number) => z.number().int().min(0).max(maximum);
const pageMarginsSchema = z.strictObject({
  topMm: marginSchema(150),
  rightMm: marginSchema(80),
  bottomMm: marginSchema(150),
  leftMm: marginSchema(80),
});

const companyProfileDetailsSchema = z.strictObject({
  companyName: shortText(200),
  street: shortText(200),
  postalCode: shortText(20),
  city: shortText(200),
  phone: shortText(100),
  email: shortText(200),
  website: shortText(200),
  registerCourt: shortText(200),
  registerNumber: shortText(100),
  managingDirectors: shortText(500),
  taxNumber: shortText(100),
  vatId: shortText(100),
  bankName: shortText(200),
  iban: shortText(100),
  bic: shortText(20),
  offerOpeningText: shortText(4000),
  offerClosingText: shortText(4000),
  offerValidityDays: z.number().int().min(1).max(365),
  standardTaxRateBasisPoints: z.number().int().min(0).max(10000),
  firstPageMargins: pageMarginsSchema,
  followingPageMargins: pageMarginsSchema,
});

export type CompanyProfileDetails = z.output<typeof companyProfileDetailsSchema>;

export const saveCompanyProfileInputSchema = z.strictObject({
  organizationId: uuidSchema,
  expectedVersion: z.number().int().min(0),
  details: companyProfileDetailsSchema,
});
export type SaveCompanyProfileInput = z.input<typeof saveCompanyProfileInputSchema>;
export type SaveCompanyProfileResult = ActionResult<{ version: number }>;

/** The standard tax rates the office chooses from for a position without an article. */
export const STANDARD_TAX_RATE_OPTIONS = [
  { basisPoints: 1900, label: '19 %' },
  { basisPoints: 700, label: '7 %' },
  { basisPoints: 0, label: '0 %' },
] as const;

/** The details of an organization that has saved none: the table's column defaults. */
export const EMPTY_COMPANY_PROFILE_DETAILS: CompanyProfileDetails = {
  companyName: '',
  street: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  website: '',
  registerCourt: '',
  registerNumber: '',
  managingDirectors: '',
  taxNumber: '',
  vatId: '',
  bankName: '',
  iban: '',
  bic: '',
  offerOpeningText: '',
  offerClosingText: '',
  offerValidityDays: 30,
  standardTaxRateBasisPoints: 1900,
  firstPageMargins: { topMm: 45, rightMm: 20, bottomMm: 25, leftMm: 25 },
  followingPageMargins: { topMm: 30, rightMm: 20, bottomMm: 25, leftMm: 25 },
};

export const COMPANY_FILE_KINDS = ['logo', 'stationery_first', 'stationery_following'] as const;
export type CompanyFileKind = (typeof COMPANY_FILE_KINDS)[number];

/** The types and the size limit each file accepts; the renderer embeds exactly these. */
export const COMPANY_FILE_RULES: Record<
  CompanyFileKind,
  { mimeTypes: readonly string[]; maxSizeBytes: number }
> = {
  logo: { mimeTypes: ['image/png', 'image/jpeg'], maxSizeBytes: 2 * 1024 * 1024 },
  stationery_first: {
    mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxSizeBytes: 5 * 1024 * 1024,
  },
  stationery_following: {
    mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxSizeBytes: 5 * 1024 * 1024,
  },
};

/** What the settings show of a stored file: that it exists, and its type. */
export type StoredCompanyFile = { mimeType: string };

export type CompanyDocumentProfile = {
  version: number;
  /** When the details or a file last changed; null before the first save. */
  updatedAt: string | null;
  details: CompanyProfileDetails;
  files: Record<CompanyFileKind, StoredCompanyFile | null>;
};

export const companyFileTicketInputSchema = z.strictObject({
  organizationId: uuidSchema,
  kind: z.enum(COMPANY_FILE_KINDS),
  mimeType: z.string().max(100),
  fileSizeBytes: z.number().int().min(0),
});
export type CompanyFileTicketInput = z.input<typeof companyFileTicketInputSchema>;
export type CompanyFileTicketResult = ActionResult<{ ticket: { fileId: string; uploadUrl: string } }>;

export const companyFileFinalizeInputSchema = z.strictObject({
  organizationId: uuidSchema,
  kind: z.enum(COMPANY_FILE_KINDS),
  fileId: uuidSchema,
});
export type CompanyFileFinalizeInput = z.input<typeof companyFileFinalizeInputSchema>;

export const companyFileRemoveInputSchema = z.strictObject({
  organizationId: uuidSchema,
  kind: z.enum(COMPANY_FILE_KINDS),
});
export type CompanyFileRemoveInput = z.input<typeof companyFileRemoveInputSchema>;

/**
 * The details a German business letter usually names and this profile still
 * lacks, in the order of the form. A hint names them; nothing waits for them
 * (no legal conclusion: the office decides what its letters need).
 */
export function missingLetterDetails(details: CompanyProfileDetails): string[] {
  const usual: Array<[string, boolean]> = [
    ['Firma mit Rechtsform', details.companyName !== ''],
    ['Anschrift', details.street !== '' && details.postalCode !== '' && details.city !== ''],
    ['Registergericht und Registernummer', details.registerCourt !== '' && details.registerNumber !== ''],
    ['Geschäftsführung oder Inhaber', details.managingDirectors !== ''],
    ['Steuernummer oder USt-IdNr.', details.taxNumber !== '' || details.vatId !== ''],
    ['Bankverbindung', details.iban !== ''],
  ];
  return usual.filter(([, present]) => !present).map(([label]) => label);
}
