import { addressSchema } from '@/lib/auth/address-cookies';
import { z } from '@/lib/zod';

// A contact's email is one address or blank. The save checks it, and the
// mail link opens only for a stored value that is one address.

/** Blank means no email; any other value must be one address. */
export const contactEmailSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  addressSchema.nullish(),
);

const CONTACT_EMAIL_MESSAGE = 'Bitte gib eine gültige E-Mail-Adresse ein oder lass das Feld leer.';

/** The field error of a contact draft's email, or undefined when the save may send it. */
export function contactEmailError(email: string | undefined): string | undefined {
  return contactEmailSchema.safeParse(email).success ? undefined : CONTACT_EMAIL_MESSAGE;
}

/** The `mailto:` href of a stored email, or null when the text is not one address (saved before the check). */
export function contactMailtoHref(email: string): string | null {
  const parsed = addressSchema.safeParse(email);
  return parsed.success ? `mailto:${encodeURIComponent(parsed.data).replaceAll('%40', '@')}` : null;
}
