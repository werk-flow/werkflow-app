import {
  SITE_CONTACT_ROLE_LABELS,
  SITE_ROLE_LABELS,
  siteContactRoleSchema,
  siteRoleKindSchema,
} from '@/lib/clients/site-roles';
import { CLIENT_TYPE_LABELS } from '@/lib/jobs/types';
import { formatGermanDate } from '@/lib/utils';
import { z } from '@/lib/zod';

/**
 * One row of `client_master_events` as the chronology reads it: a changed
 * identity field, the customer, a contact or a site archived or restored, or
 * a role on an Einsatzort started or ended.
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
  source_number: 'Nummer im Altsystem',
  site_role: 'Rolle am Einsatzort',
  site_id: 'Einsatzort',
};

/** A role started or ended, as `record_client_site_role_change` writes it. */
const roleEventSchema = z.object({
  role: z.string(),
  holder_name: z.string(),
  site_client_id: z.string(),
  site_name: z.string(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
});

/** The customer whose page shows the Einsatzort of a role event; null for any other event. */
export function roleEventSiteClientId(payload: unknown): string | null {
  const role = roleEventSchema.safeParse(payload);
  return role.success ? role.data.site_client_id : null;
}

function describeRoleEvent(
  eventType: string,
  payload: unknown,
): { reference: string; detail: string | null } {
  const event = roleEventSchema.safeParse(payload);
  const verb = eventType === 'role_started' ? 'eingetragen' : 'beendet';
  if (!event.success) return { reference: `Rolle am Einsatzort ${verb}`, detail: null };
  const kind = siteRoleKindSchema.safeParse(event.data.role);
  const label = kind.success ? SITE_ROLE_LABELS[kind.data] : 'Rolle';
  const { starts_on: startsOn, ends_on: endsOn } = event.data;
  const detail =
    eventType === 'role_ended' && endsOn
      ? `${event.data.holder_name}, letzter Tag ${formatGermanDate(endsOn)}`
      : `${event.data.holder_name}${startsOn ? `, ab ${formatGermanDate(startsOn)}` : ''}`;
  return { reference: `${label} für ${event.data.site_name} ${verb}`, detail };
}

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
  const siteRole = field === 'site_role' ? siteContactRoleSchema.safeParse(value) : null;
  if (siteRole?.success) return `„${SITE_CONTACT_ROLE_LABELS[siteRole.data]}“`;
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
  if (event.eventType === 'role_started' || event.eventType === 'role_ended')
    return describeRoleEvent(event.eventType, event.payload);
  const change = changeSchema.safeParse(event.payload);
  if (!change.success) return { reference: `${subject} geändert`, detail: null };
  const { field } = change.data;
  const label = FIELD_LABELS[field] ?? 'Stammdaten';
  // A contact's Einsatzort is an id; its name shows in the contact card.
  if (field === 'site_id') return { reference: `${subject}: ${label} geändert`, detail: null };
  return {
    reference: event.isContact || event.isSite ? `${subject}: ${label} geändert` : `${label} geändert`,
    detail: `${shownValue(field, change.data.old)} → ${shownValue(field, change.data.new)}`,
  };
}
