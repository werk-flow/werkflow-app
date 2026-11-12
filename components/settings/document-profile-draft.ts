import { COMPANY_TEXT_LIMITS, type CompanyProfileDetails } from '@/lib/company-profile/profile';

// The company details form's draft: every field as typed, and its parse into
// the details the save sends. Numbers stay text while typed, so a half-typed
// value is never rewritten under the cursor.

type TextFieldKey = Exclude<
  keyof CompanyProfileDetails,
  'offerValidityDays' | 'standardTaxRateBasisPoints' | 'firstPageMargins' | 'followingPageMargins'
>;

export type TextFieldDefinition = {
  key: TextFieldKey;
  label: string;
  description?: string;
  multiline?: boolean;
  autoComplete?: string;
};

/** The text fields in the order of the form, grouped by what a letter uses them for. */
export const TEXT_FIELD_SECTIONS: ReadonlyArray<{ title: string; fields: readonly TextFieldDefinition[] }> = [
  {
    title: 'Firma und Anschrift',
    fields: [
      { key: 'companyName', label: 'Firma mit Rechtsform', autoComplete: 'organization' },
      { key: 'street', label: 'Straße und Hausnummer', autoComplete: 'address-line1' },
      { key: 'postalCode', label: 'PLZ', autoComplete: 'postal-code' },
      { key: 'city', label: 'Ort', autoComplete: 'address-level2' },
    ],
  },
  {
    title: 'Kontakt',
    fields: [
      { key: 'phone', label: 'Telefon', autoComplete: 'tel' },
      { key: 'email', label: 'E-Mail', autoComplete: 'email' },
      { key: 'website', label: 'Website', autoComplete: 'url' },
    ],
  },
  {
    title: 'Register und Steuern',
    fields: [
      {
        key: 'registerCourt',
        label: 'Registergericht',
        description: 'Zum Beispiel „Amtsgericht Musterstadt“.',
      },
      { key: 'registerNumber', label: 'Registernummer', description: 'Zum Beispiel „HRB 12345“.' },
      {
        key: 'managingDirectors',
        label: 'Geschäftsführung oder Inhaber',
        description: 'So, wie es im Fuß stehen soll, zum Beispiel „Geschäftsführer: Max Mustermann“.',
      },
      { key: 'taxNumber', label: 'Steuernummer' },
      { key: 'vatId', label: 'USt-IdNr.' },
    ],
  },
  {
    title: 'Bankverbindung',
    fields: [
      { key: 'bankName', label: 'Bank' },
      { key: 'iban', label: 'IBAN' },
      { key: 'bic', label: 'BIC' },
    ],
  },
  {
    title: 'Neue Angebote',
    fields: [
      {
        key: 'offerOpeningText',
        label: 'Einleitung',
        description: 'Steht über den Positionen. Leer bleibt der Text des Musterangebots.',
        multiline: true,
      },
      {
        key: 'offerClosingText',
        label: 'Schluss',
        description: 'Steht unter der Summe, mit Gruß und Namen.',
        multiline: true,
      },
    ],
  },
];

type MarginDraft = Record<keyof CompanyProfileDetails['firstPageMargins'], string>;

export type ProfileDraft = Record<TextFieldKey, string> & {
  offerValidityDays: string;
  standardTaxRateBasisPoints: number;
  firstPageMargins: MarginDraft;
  followingPageMargins: MarginDraft;
};

export const MARGIN_SIDES = [
  { side: 'topMm', label: 'Oben', maximum: 150 },
  { side: 'rightMm', label: 'Rechts', maximum: 80 },
  { side: 'bottomMm', label: 'Unten', maximum: 150 },
  { side: 'leftMm', label: 'Links', maximum: 80 },
] as const;

export type MarginPage = 'firstPageMargins' | 'followingPageMargins';

/** The control id of a field, stable so an invalid submit can focus it. */
export const fieldId = (key: string, side?: string) => `company-profile-${key}${side ? `-${side}` : ''}`;

function marginDraft(margins: CompanyProfileDetails['firstPageMargins']): MarginDraft {
  return {
    topMm: String(margins.topMm),
    rightMm: String(margins.rightMm),
    bottomMm: String(margins.bottomMm),
    leftMm: String(margins.leftMm),
  };
}

export function draftOf(details: CompanyProfileDetails): ProfileDraft {
  return {
    ...details,
    offerValidityDays: String(details.offerValidityDays),
    firstPageMargins: marginDraft(details.firstPageMargins),
    followingPageMargins: marginDraft(details.followingPageMargins),
  };
}

/** A whole number from typed text within the range, or null. */
function wholeNumber(text: string, minimum: number, maximum: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= minimum && value <= maximum ? value : null;
}

type ParsedDraft =
  | { kind: 'valid'; details: CompanyProfileDetails }
  | { kind: 'invalid'; errors: Record<string, string> };

/** The details of a valid draft, or the message of each invalid field by its control id. */
export function parseDraft(draft: ProfileDraft): ParsedDraft {
  const errors: Record<string, string> = {};
  // In the order of the form, so an invalid submit focuses the first marked field.
  for (const { key } of TEXT_FIELD_SECTIONS.flatMap((section) => section.fields)) {
    const limit = COMPANY_TEXT_LIMITS[key];
    if (draft[key].trim().length > limit) errors[fieldId(key)] = `Höchstens ${limit} Zeichen.`;
  }
  const validity = wholeNumber(draft.offerValidityDays, 1, 365);
  if (validity === null) errors[fieldId('offerValidityDays')] = 'Gib eine Zahl von 1 bis 365 ein.';
  const margins = (page: MarginPage) => {
    const parsed = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
    for (const { side, maximum } of MARGIN_SIDES) {
      const value = wholeNumber(draft[page][side], 0, maximum);
      if (value === null) errors[fieldId(page, side)] = `Gib einen Rand von 0 bis ${maximum} mm ein.`;
      else parsed[side] = value;
    }
    return parsed;
  };
  const firstPageMargins = margins('firstPageMargins');
  const followingPageMargins = margins('followingPageMargins');
  if (validity === null || Object.keys(errors).length > 0) return { kind: 'invalid', errors };
  const text = (key: TextFieldKey) => draft[key].trim();
  return {
    kind: 'valid',
    details: {
      companyName: text('companyName'),
      street: text('street'),
      postalCode: text('postalCode'),
      city: text('city'),
      phone: text('phone'),
      email: text('email'),
      website: text('website'),
      registerCourt: text('registerCourt'),
      registerNumber: text('registerNumber'),
      managingDirectors: text('managingDirectors'),
      taxNumber: text('taxNumber'),
      vatId: text('vatId'),
      bankName: text('bankName'),
      iban: text('iban'),
      bic: text('bic'),
      offerOpeningText: text('offerOpeningText'),
      offerClosingText: text('offerClosingText'),
      offerValidityDays: validity,
      standardTaxRateBasisPoints: draft.standardTaxRateBasisPoints,
      firstPageMargins,
      followingPageMargins,
    },
  };
}
