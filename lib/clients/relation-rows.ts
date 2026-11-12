import 'server-only';

import { siteContactRoleSchema } from '@/lib/clients/site-roles';
import type { ClientContact, ClientContactRow, ClientSite, ClientSiteRow } from '@/lib/clients/types';

// The contact and Objekt rows as the server maps them. They live apart from
// lib/clients/types.ts, which the job pages' client code imports, so the
// role schema stays out of those pages.

function siteLink(
  siteId: string | null,
  siteRole: string | null,
): Pick<ClientContact, 'siteId' | 'siteRole'> {
  const role = siteContactRoleSchema.safeParse(siteRole);
  return siteId && role.success ? { siteId, siteRole: role.data } : { siteId: null, siteRole: null };
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
    // A role a later release adds shows as no role at the Objekt.
    ...siteLink(row.site_id, row.site_role),
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
    sourceNumber: row.source_number,
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
