import type { BusinessDocument, DocumentImage, StationeryFile } from '@/lib/document-rendering/model';

import type { CompanyFileKind, CompanyProfileDetails } from './profile';

// Maps the company document profile onto the renderer's model: who sends,
// what the footer says, which stationery lies under the pages, and the
// texts and validity a new offer starts with. A detail left empty is left
// out, never printed as a blank label.

/** The profile's stored files, read as bytes. */
export type LetterheadFiles = Partial<Record<CompanyFileKind, StationeryFile>>;

/** What a generated offer takes from the profile. */
export type OfferLetterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'> & {
  openingText: string;
  closingText: string;
  validityDays: number;
};

const filledLines = (lines: string[]) => lines.filter((line) => line !== '');

function cityLine(details: CompanyProfileDetails): string {
  return `${details.postalCode} ${details.city}`.trim();
}

function asImage(file: StationeryFile | undefined): DocumentImage | null {
  return file && file.format !== 'pdf' ? file : null;
}

/**
 * The profile as a document's letterhead. The organization's name stands in
 * for an empty firm name, so a new organization's documents still name a sender.
 */
export function offerLetterhead(
  details: CompanyProfileDetails,
  files: LetterheadFiles,
  organizationName: string,
): OfferLetterhead {
  const name = details.companyName || organizationName;
  const address = filledLines([details.street, cityLine(details)]);
  const register = filledLines([details.registerCourt, details.registerNumber]).join(' ');
  const footerColumns = [
    filledLines([name, ...address]),
    filledLines([details.phone && `Tel. ${details.phone}`, details.email, details.website]),
    filledLines([
      register,
      details.managingDirectors,
      details.taxNumber && `St.-Nr. ${details.taxNumber}`,
      details.vatId && `USt-IdNr. ${details.vatId}`,
    ]),
    filledLines([
      details.bankName,
      details.iban && `IBAN ${details.iban}`,
      details.bic && `BIC ${details.bic}`,
    ]),
  ].filter((column) => column.length > 0);
  const firstPage = files.stationery_first;
  const followingPages = files.stationery_following;
  return {
    sender: { name, addressLines: address, logo: asImage(files.logo) },
    footerColumns,
    stationery: firstPage
      ? {
          firstPage: { file: firstPage, margins: details.firstPageMargins },
          followingPages: followingPages
            ? { file: followingPages, margins: details.followingPageMargins }
            : null,
        }
      : null,
    openingText: details.offerOpeningText,
    closingText: details.offerClosingText,
    validityDays: details.offerValidityDays,
  };
}
