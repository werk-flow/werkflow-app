import { describeFailure } from '@/lib/action-messages';
import type { SaveClientContactInput, SaveClientSiteInput } from '@/lib/clients/actions';

const ERROR_MESSAGES: Record<string, string> = {
  name_required: 'Bitte gib einen Namen ein.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
  contact_not_found: 'Der Ansprechpartner wurde nicht gefunden.',
  site_not_found: 'Der Einsatzort wurde nicht gefunden.',
  no_changes: 'Keine Änderungen zum Speichern.',
};

export function errorMessage(error: string): string {
  return describeFailure(error, ERROR_MESSAGES, 'Speichern fehlgeschlagen. Bitte versuche es erneut.');
}

type ContactDraft = SaveClientContactInput;
type SiteDraft = SaveClientSiteInput;

/** The open contact dialog; `contactId` is null while a new contact is entered. */
export type ContactDialogState = {
  contactId: string | null;
  draft: ContactDraft;
  error: string | null;
  nameError?: string | null;
};

/** The open site dialog; `siteId` is null while a new site is entered. */
export type SiteDialogState = {
  siteId: string | null;
  draft: SiteDraft;
  error: string | null;
  nameError?: string | null;
};

export const getRelationId = (relation: { id: string }): string => relation.id;

export const EMPTY_CONTACT: ContactDraft = {
  name: '',
  role: '',
  email: '',
  phone: '',
  notes: '',
  isPrimary: false,
};

export const EMPTY_SITE: SiteDraft = {
  name: '',
  street: '',
  postalCode: '',
  city: '',
  accessNotes: '',
  notes: '',
  primaryContactId: null,
  isPrimary: false,
};
