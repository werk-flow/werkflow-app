import { CLIENT_TYPE_LABELS } from '@/lib/jobs/types';
import { z } from '@/lib/zod';

/**
 * One row of `client_master_events` as the chronology reads it: a changed
 * identity field, or the customer, a contact or a site archived or restored.
 */
export type MasterDataEvent = {
  eventType: string;
  payload: unknown;
  contactName: string | null;
  siteName: string | null;
  isContact: boolean;
  isSite: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  client_type: 'Kundentyp',
  customer_number: 'Kundennummer',
  address: 'Adresse',
  email: 'E-Mail',
  phone: 'Telefon',
  street: 'Straße',
  postal_code: 'PLZ',
  city: 'Ort',
};

const changeSchema = z.object({
  field: z.string(),
  old: z.string().nullable(),
  new: z.string().nullable(),
});

const CLIENT_TYPES = ['privat', 'gewerblich'] as const;

function shownValue(field: string, value: string | null): string {
  if (value === null || value.trim() === '') return 'leer';
  // A type a later release adds shows as stored.
  const clientType = field === 'client_type' ? CLIENT_TYPES.find((type) => type === value) : undefined;
  if (clientType) return `„${CLIENT_TYPE_LABELS[clientType]}“`;
  return `„${value}“`;
}

/**
 * The chronology's words for one master-data event: what changed („Telefon
 * geändert“, „Ansprechpartner Erika Musterfrau archiviert“) and, for a
 * change, the old and the new value.
 */
export function describeMasterDataEvent(event: MasterDataEvent): {
  reference: string;
  detail: string | null;
} {
  const subject = event.isContact
    ? `Ansprechpartner ${event.contactName ?? ''}`.trim()
    : event.isSite
      ? `Einsatzort ${event.siteName ?? ''}`.trim()
      : 'Kunde';
  if (event.eventType === 'archived') return { reference: `${subject} archiviert`, detail: null };
  if (event.eventType === 'restored') return { reference: `${subject} wiederhergestellt`, detail: null };
  const change = changeSchema.safeParse(event.payload);
  if (!change.success) return { reference: `${subject} geändert`, detail: null };
  const { field } = change.data;
  const label = FIELD_LABELS[field] ?? 'Stammdaten';
  return {
    reference: event.isContact || event.isSite ? `${subject}: ${label} geändert` : `${label} geändert`,
    detail: `${shownValue(field, change.data.old)} → ${shownValue(field, change.data.new)}`,
  };
}
