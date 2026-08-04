import type { Database } from '@/lib/supabase/database.types';

// ============================================
// Database Row Aliases
// ============================================

export type ClientContactRow =
  Database['public']['Tables']['client_contacts']['Row'];
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

// ============================================
// Result Types
// ============================================

export type ClientContactResult =
  | { success: true; contact: ClientContact }
  | { success: false; error: string };

export type ClientSiteResult =
  | { success: true; site: ClientSite }
  | { success: false; error: string };

export type ClientRelationsResult =
  | { success: true; contacts: ClientContact[]; sites: ClientSite[] }
  | { success: false; error: string };

// ============================================
// Converters And Helpers
// ============================================

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
export function formatSiteAddress(
  site: Pick<ClientSite, 'street' | 'postalCode' | 'city'>
): string {
  const cityLine = [site.postalCode, site.city].filter(Boolean).join(' ');
  return [site.street, cityLine].filter(Boolean).join(', ');
}
