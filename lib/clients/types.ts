import type { ActionFailure, ActionResult } from '@/lib/action-result';
import type { Database } from '@/lib/supabase/database.types';

// ============================================
// Database Row Aliases
// ============================================

export type ClientContactRow = Database['public']['Tables']['client_contacts']['Row'];
export type ClientSiteRow = Database['public']['Tables']['client_sites']['Row'];

// ============================================
// Application-Level Types (camelCase)
// ============================================

export type ClientContact = {
  id: string;
  organizationId: string;
  clientId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientSite = {
  id: string;
  organizationId: string;
  clientId: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  accessNotes: string | null;
  notes: string | null;
  primaryContactId: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// Suggested German contact roles; the field itself stays free text so
// organizations can use their own vocabulary.
export const CONTACT_ROLE_SUGGESTIONS = [
  'Eigentümer/in',
  'Mieter/in',
  'Hausverwaltung',
  'Hausmeister/in',
  'Bauleitung',
  'Architekt/in',
  'Einkauf',
  'Rechnungsempfänger/in',
  'Notfallkontakt',
] as const;

/**
 * Why an existing customer may be the one a draft or a caller describes, in
 * the order `find_client_duplicates` lists them: the customer number, the
 * phone, the email, the name together with the postal code, and the street
 * together with the postal code.
 */
const CLIENT_MATCH_REASONS = ['customer_number', 'phone', 'email', 'name', 'address'] as const;
export type ClientMatchReason = (typeof CLIENT_MATCH_REASONS)[number];

export const CLIENT_MATCH_REASON_LABELS: Record<ClientMatchReason, string> = {
  customer_number: 'Kundennummer',
  phone: 'Telefon',
  email: 'E-Mail',
  name: 'Name und PLZ',
  address: 'Straße und PLZ',
};

/** A customer of the organization that a draft customer or a caller may already be. */
export type ClientMatch = {
  clientId: string;
  clientName: string;
  matchedOn: ClientMatchReason[];
};

/** The strongest matches; `moreMatches` says that more customers match than are listed. */
export type ClientMatchList = { matches: ClientMatch[]; moreMatches: boolean };

// ============================================
// Result Types
// ============================================

export type ClientContactResult = ActionResult<{ contact: ClientContact }>;

export type ClientSiteResult = ActionResult<{ site: ClientSite }>;

export type ClientRelationsResult = ActionResult<{ contacts: ClientContact[]; sites: ClientSite[] }>;

/** The first save of a new customer that matches existing ones saves nothing and lists them. */
export type ClientDuplicatesFailure = ActionFailure<'possible_duplicates'> & ClientMatchList;

// ============================================
// Converters And Helpers
// ============================================

type ClientMatchRow = Database['public']['Functions']['find_client_duplicates']['Returns'][number];

function isClientMatchReason(value: string): value is ClientMatchReason {
  return CLIENT_MATCH_REASONS.some((reason) => reason === value);
}

export function toClientMatch(row: ClientMatchRow): ClientMatch {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    matchedOn: row.matched_on.filter(isClientMatchReason),
  };
}

export function toClientContact(row: ClientContactRow): ClientContact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    isPrimary: row.is_primary,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toClientSite(row: ClientSiteRow): ClientSite {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    name: row.name,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    accessNotes: row.access_notes,
    notes: row.notes,
    primaryContactId: row.primary_contact_id,
    isPrimary: row.is_primary,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// One-line address for pickers, job "Ort" snapshots, and calendar context.
/** The same one-line address for a site row as the database returns it. */
export function formatSiteRowAddress(site: {
  street: string | null;
  postal_code: string | null;
  city: string | null;
}): string {
  return [site.street, [site.postal_code, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export function formatSiteAddress(site: Pick<ClientSite, 'street' | 'postalCode' | 'city'>): string {
  const cityLine = [site.postalCode, site.city].filter(Boolean).join(' ');
  return [site.street, cityLine].filter(Boolean).join(', ');
}
