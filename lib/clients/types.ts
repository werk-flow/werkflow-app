import type { ActionFailure, ActionResult } from '@/lib/action-result';
import type { SiteContactRole } from '@/lib/clients/site-roles';
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
  /** The Objekt of the customer the contact lives at or opens, with that role. */
  siteId: string | null;
  siteRole: SiteContactRole | null;
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
  /** The number the previous system gave the Objekt. */
  sourceNumber: string | null;
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

/**
 * The records that keep a customer from deletion, counted per kind as
 * `app_private.client_links` counts them. A kind without records is absent.
 */
export type ClientLinkKind =
  | 'jobs'
  | 'projects'
  | 'requests'
  | 'service_cases'
  | 'equipment'
  | 'maintenance'
  | 'documents'
  | 'follow_ups'
  | 'site_roles';
export type ClientLinks = { [Kind in ClientLinkKind]?: number | undefined };

/** Archiving or restoring answers the customer's archive mark: null while it is active. */
export type ClientArchiveResult = ActionResult<{ archivedAt: string | null }>;

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
