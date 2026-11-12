'use server';

import type { ActionResult } from '@/lib/action-result';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { contactEmailSchema } from '@/lib/clients/contact-email';
import { requireManagerAndClient } from '@/lib/clients/manager-access';
import { siteContactRoleSchema, type SiteContactRole } from '@/lib/clients/site-roles';
import {
  type Client,
  type ClientType,
  type CreateClientResult,
  type UpdateClientResult,
  type DeleteClientResult,
  toClient,
} from '@/lib/jobs/types';
import {
  type ClientArchiveResult,
  type ClientContactResult,
  type ClientLinks,
  type ClientMatchList,
  type ClientRelationsResult,
  type ClientSiteResult,
  toClientMatch,
} from '@/lib/clients/types';
import { toClientContact, toClientSite } from '@/lib/clients/relation-rows';
import { logError } from '@/lib/logging';
import { Constants, type Json } from '@/lib/supabase/database.types';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// ============================================
// Input Types
// ============================================

export type CreateClientInput = {
  name: string;
  clientType: ClientType;
  customerNumber?: string;
  /** The number the previous system gave the customer. */
  sourceNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
};

export type UpdateClientInput = Partial<CreateClientInput>;

// Arguments arrive from the network unchecked; these schemas bound every field
// before use. Blank names still reach the `name_required` checks below.
const nullableClientText = (maximum: number) => z.string().max(maximum).nullish();

const clientFieldsSchema = z.object({
  name: z.string().max(300),
  clientType: z.enum(Constants.public.Enums.client_type),
  customerNumber: nullableClientText(100),
  sourceNumber: nullableClientText(100),
  email: nullableClientText(320),
  phone: nullableClientText(100),
  address: nullableClientText(1000),
  notes: nullableClientText(10000),
});

const createClientArgumentsSchema = z.object({
  input: clientFieldsSchema,
  createDespiteMatches: z.boolean().optional(),
});

const updateClientArgumentsSchema = z.object({ clientId: uuidSchema, input: clientFieldsSchema.partial() });

const contactFieldsSchema = z.object({
  name: z.string().max(300),
  role: nullableClientText(200),
  email: contactEmailSchema,
  phone: nullableClientText(100),
  notes: nullableClientText(10000),
  // The contact's Objekt and its role there come together or not at all.
  siteId: uuidSchema.nullish(),
  siteRole: siteContactRoleSchema.nullish(),
  isPrimary: z.boolean().optional(),
});

const siteFieldsSchema = z.object({
  name: z.string().max(300),
  street: nullableClientText(300),
  postalCode: nullableClientText(20),
  city: nullableClientText(200),
  sourceNumber: nullableClientText(100),
  accessNotes: nullableClientText(10000),
  notes: nullableClientText(10000),
  primaryContactId: uuidSchema.or(z.literal('')).nullish(),
  isPrimary: z.boolean().optional(),
});

const hasWholeSiteLink = (input: {
  siteId?: string | null | undefined;
  siteRole?: string | null | undefined;
}): boolean =>
  (input.siteId === undefined) === (input.siteRole === undefined) && !input.siteId === !input.siteRole;
const createContactArgumentsSchema = z.object({
  clientId: uuidSchema,
  input: contactFieldsSchema.refine(hasWholeSiteLink),
});
const updateContactArgumentsSchema = z.object({
  contactId: uuidSchema,
  input: contactFieldsSchema.partial().extend({ isActive: z.boolean().optional() }).refine(hasWholeSiteLink),
});
const createSiteArgumentsSchema = z.object({ clientId: uuidSchema, input: siteFieldsSchema });
const updateSiteArgumentsSchema = z.object({
  siteId: uuidSchema,
  input: siteFieldsSchema.partial().extend({ isActive: z.boolean().optional() }),
});
const clientRelationsArgumentsSchema = z.object({
  clientId: uuidSchema,
  options: z.object({ includeInactive: z.boolean().optional() }).optional(),
});

const linkCount = z.number().int().positive().optional();
/** What `delete_unlinked_client` answers: deleted, or kept with what links to it. */
const clientDeletionSchema = z.object({
  deleted: z.boolean(),
  links: z.object({
    jobs: linkCount,
    projects: linkCount,
    requests: linkCount,
    service_cases: linkCount,
    equipment: linkCount,
    maintenance: linkCount,
    documents: linkCount,
    follow_ups: linkCount,
    site_roles: linkCount,
    billing_parties: linkCount,
  }),
});

// The refusals the customer write functions raise under their lock
// (supabase/migrations/20261130090001_archive_customers_and_keep_master_data_history.sql).
/** A source number another customer or Objekt of the organization already has. */
function isSourceNumberTaken(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' && (error.message ?? '').includes('source_number_per_org');
}

const masterWriteRefusal = writeRefusalFor(
  new Set([
    'client_not_found',
    'contact_not_found',
    'site_not_found',
    'not_authorized',
    'client_already_archived',
    'client_not_archived',
  ]),
);

// ============================================
// Actions
// ============================================

// The strongest likely duplicates the create dialog lists; it says when more exist.
const DUPLICATE_MATCH_LIMIT = 5;

// The organization's customers a draft customer may already be, by
// find_client_duplicates (supabase/tests/client_duplicates.sql owns the reasons).
async function readClientDuplicates(
  admin: AdminClient,
  orgId: string,
  draft: z.infer<typeof clientFieldsSchema>,
): Promise<ActionResult<ClientMatchList>> {
  // One row past the shown matches tells whether more exist.
  const { data, error } = await admin.rpc('find_client_duplicates', {
    p_organization_id: orgId,
    p_customer_number: draft.customerNumber ?? '',
    p_name: draft.name,
    p_phone: draft.phone ?? '',
    p_email: draft.email ?? '',
    p_address: draft.address ?? '',
    p_limit: DUPLICATE_MATCH_LIMIT + 1,
  });
  if (error) {
    logError('readClientDuplicates: duplicate lookup failed', error);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    matches: data.slice(0, DUPLICATE_MATCH_LIMIT).map(toClientMatch),
    moreMatches: data.length > DUPLICATE_MATCH_LIMIT,
  };
}

// Creates a customer. While the draft matches existing customers, only a
// creation the user confirmed saves; an unconfirmed one saves nothing and
// returns the matches with their reasons.
export async function createClient(
  rawInput: CreateClientInput,
  rawCreateDespiteMatches?: boolean,
): Promise<CreateClientResult> {
  const parsed = createClientArgumentsSchema.safeParse({
    input: rawInput,
    createDespiteMatches: rawCreateDespiteMatches,
  });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { input, createDespiteMatches } = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    if (!input.name.trim()) {
      return { success: false, error: 'name_required' };
    }

    const admin = createSupabaseAdminClient();

    if (!createDespiteMatches) {
      const lookup = await readClientDuplicates(admin, orgId, input);
      if (!lookup.success) return lookup;
      if (lookup.matches.length > 0) {
        return {
          success: false,
          error: 'possible_duplicates',
          matches: lookup.matches,
          moreMatches: lookup.moreMatches,
        };
      }
    }

    const { data, error } = await admin
      .from('clients')
      .insert({
        organization_id: orgId,
        name: input.name.trim(),
        client_type: input.clientType,
        customer_number: input.customerNumber?.trim() || null,
        source_number: input.sourceNumber?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single();

    if (error || !data) {
      logError('Error creating client:', error);
      if (isSourceNumberTaken(error)) return { success: false, error: 'source_number_taken' };
      if (error?.code === '23505') {
        return { success: false, error: 'customer_number_taken' };
      }
      return { success: false, error: 'create_failed' };
    }

    return { success: true, client: toClient(data) };
  } catch (error) {
    logError('Unexpected error in createClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClient(
  rawClientId: string,
  rawInput: UpdateClientInput,
): Promise<UpdateClientResult> {
  const parsed = updateClientArgumentsSchema.safeParse({ clientId: rawClientId, input: rawInput });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { clientId, input } = parsed.data;
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;

    const changes: Record<string, string | null> = {};
    if (input.name !== undefined) changes.name = input.name.trim();
    if (input.clientType !== undefined) changes.client_type = input.clientType;
    if (input.customerNumber !== undefined) changes.customer_number = input.customerNumber?.trim() || null;
    if (input.sourceNumber !== undefined) changes.source_number = input.sourceNumber?.trim() || null;
    if (input.email !== undefined) changes.email = input.email?.trim() || null;
    if (input.phone !== undefined) changes.phone = input.phone?.trim() || null;
    if (input.address !== undefined) changes.address = input.address?.trim() || null;
    if (input.notes !== undefined) changes.notes = input.notes?.trim() || null;

    if (Object.keys(changes).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    // The function writes one history entry per changed identity field.
    const { data, error } = await admin.rpc('update_client_master', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_client_id: clientId,
      p_changes: changes,
    });
    if (isSourceNumberTaken(error)) return { success: false, error: 'source_number_taken' };
    if (error?.code === '23505') return { success: false, error: 'customer_number_taken' };
    if (error || !data) return masterWriteRefusal(error, 'update_failed', 'updateClient: save failed');

    return { success: true, client: toClient(data) };
  } catch (error) {
    logError('Unexpected error in updateClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Deletes a customer nothing links to, a mistaken entry. A customer with
 * work, requests, service records, documents or follow-ups is kept, and the
 * refusal names what links to it so the dialog can offer archiving.
 */
export async function deleteClient(
  rawClientId: string,
): Promise<DeleteClientResult & { links?: ClientLinks }> {
  const parsedClientId = uuidSchema.safeParse(rawClientId);
  if (!parsedClientId.success) return { success: false, error: 'invalid_input' };
  const clientId = parsedClientId.data;
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;

    const { data, error } = await admin.rpc('delete_unlinked_client', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_client_id: clientId,
    });
    if (error) return masterWriteRefusal(error, 'delete_failed', 'deleteClient: delete failed');
    const outcome = clientDeletionSchema.safeParse(data);
    if (!outcome.success) {
      logError('deleteClient: unexpected deletion outcome', outcome.error);
      return { success: false, error: 'delete_failed' };
    }
    if (!outcome.data.deleted) {
      return { success: false, error: 'client_has_history', links: outcome.data.links };
    }
    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Archives or restores a customer; its work, requests and history stay. */
async function setClientArchived(clientId: string, archived: boolean): Promise<ClientArchiveResult> {
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;

    const { data, error } = await admin.rpc('set_client_archived', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_client_id: clientId,
      p_archived: archived,
    });
    if (error || !data) {
      return masterWriteRefusal(error, 'archive_failed', 'setClientArchived: save failed');
    }
    return { success: true, archivedAt: data.archived_at };
  } catch (error) {
    logError('Unexpected error in setClientArchived:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function archiveClient(rawClientId: string): Promise<ClientArchiveResult> {
  const clientId = uuidSchema.safeParse(rawClientId);
  if (!clientId.success) return { success: false, error: 'invalid_input' };
  return setClientArchived(clientId.data, true);
}

export async function restoreClient(rawClientId: string): Promise<ClientArchiveResult> {
  const clientId = uuidSchema.safeParse(rawClientId);
  if (!clientId.success) return { success: false, error: 'invalid_input' };
  return setClientArchived(clientId.data, false);
}

/** The customer, its archive mark (null while it is active) and its source number. */
export async function getClientDetail(
  rawClientId: string,
): Promise<ActionResult<{ client: Client; archivedAt: string | null; sourceNumber: string | null }>> {
  const parsedClientId = uuidSchema.safeParse(rawClientId);
  if (!parsedClientId.success) return { success: false, error: 'not_found' };
  const clientId = parsedClientId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .eq('organization_id', orgId)
      .single();

    // `.single()` reports a missing row as PGRST116; any other error is a failed read, not a missing client.
    if (error && error.code !== 'PGRST116') {
      logReadFailure('getClientDetail: client read failed', error);
      return { success: false, error: 'load_failed' };
    }
    if (!data) return { success: false, error: 'not_found' };

    return {
      success: true,
      client: toClient(data),
      archivedAt: data.archived_at,
      sourceNumber: data.source_number,
    };
  } catch (error) {
    logError('Unexpected error in getClientDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Contacts And Work Sites
// ============================================

/** The Objekt a contact is linked to: one of the organization's, of the given customer when named. */
async function findOwnSite(
  admin: AdminClient,
  orgId: string,
  siteId: string,
  clientId?: string,
): Promise<ActionResult> {
  let query = admin.from('client_sites').select('id').eq('id', siteId).eq('organization_id', orgId);
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    logReadFailure('findOwnSite: site read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return data ? { success: true } : { success: false, error: 'site_not_found' };
}

export type SaveClientContactInput = {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
  siteId?: string | null;
  siteRole?: SiteContactRole | null;
  isPrimary?: boolean;
};

export type SaveClientSiteInput = {
  name: string;
  street?: string;
  postalCode?: string;
  city?: string;
  sourceNumber?: string;
  accessNotes?: string;
  notes?: string;
  primaryContactId?: string | null;
  isPrimary?: boolean;
};

// A row saved as primary replaces the customer's previous primary contact or
// site inside the same statement: the keep_one_primary triggers clear it.
export async function createClientContact(
  rawClientId: string,
  rawInput: SaveClientContactInput,
): Promise<ClientContactResult> {
  const parsed = createContactArgumentsSchema.safeParse({ clientId: rawClientId, input: rawInput });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { clientId, input } = parsed.data;
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;

    if (!input.name.trim()) {
      return { success: false, error: 'name_required' };
    }

    const admin = createSupabaseAdminClient();
    if (input.siteId) {
      const site = await findOwnSite(admin, orgId, input.siteId, clientId);
      if (!site.success) return site;
    }
    const { data, error } = await admin
      .from('client_contacts')
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: input.name.trim(),
        role: input.role?.trim() || null,
        email: input.email ?? null,
        phone: input.phone?.trim() || null,
        notes: input.notes?.trim() || null,
        site_id: input.siteId ?? null,
        site_role: input.siteRole ?? null,
        is_primary: input.isPrimary ?? false,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      logError('Error creating client contact:', error);
      return { success: false, error: 'create_failed' };
    }

    return { success: true, contact: toClientContact(data) };
  } catch (error) {
    logError('Unexpected error in createClientContact:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClientContact(
  rawContactId: string,
  rawInput: Partial<SaveClientContactInput> & { isActive?: boolean },
): Promise<ClientContactResult> {
  const parsed = updateContactArgumentsSchema.safeParse({ contactId: rawContactId, input: rawInput });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { contactId, input } = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const changes: Record<string, Json> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) return { success: false, error: 'name_required' };
      changes.name = input.name.trim();
    }
    if (input.role !== undefined) changes.role = input.role?.trim() || null;
    if (input.email !== undefined) changes.email = input.email;
    if (input.phone !== undefined) changes.phone = input.phone?.trim() || null;
    if (input.notes !== undefined) changes.notes = input.notes?.trim() || null;
    if (input.siteId !== undefined) changes.site_id = input.siteId ?? null;
    if (input.siteRole !== undefined) changes.site_role = input.siteRole ?? null;
    if (input.isPrimary !== undefined) changes.is_primary = input.isPrimary;
    if (input.isActive !== undefined) changes.is_active = input.isActive;

    if (Object.keys(changes).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    // The function finds the contact in the caller's organization and writes
    // one history entry per changed identity field and for archiving. The
    // database refuses an Objekt of another customer.
    const admin = createSupabaseAdminClient();
    if (input.siteId) {
      const site = await findOwnSite(admin, orgId, input.siteId);
      if (!site.success) return site;
    }
    const { data, error } = await admin.rpc('update_client_contact', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_contact_id: contactId,
      p_changes: changes,
    });
    if (error || !data) return masterWriteRefusal(error, 'update_failed', 'updateClientContact: save failed');

    return { success: true, contact: toClientContact(data) };
  } catch (error) {
    logError('Unexpected error in updateClientContact:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function createClientSite(
  rawClientId: string,
  rawInput: SaveClientSiteInput,
): Promise<ClientSiteResult> {
  const parsed = createSiteArgumentsSchema.safeParse({ clientId: rawClientId, input: rawInput });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { clientId, input } = parsed.data;
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;

    if (!input.name.trim()) {
      return { success: false, error: 'name_required' };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('client_sites')
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: input.name.trim(),
        street: input.street?.trim() || null,
        postal_code: input.postalCode?.trim() || null,
        city: input.city?.trim() || null,
        source_number: input.sourceNumber?.trim() || null,
        access_notes: input.accessNotes?.trim() || null,
        notes: input.notes?.trim() || null,
        primary_contact_id: input.primaryContactId || null,
        is_primary: input.isPrimary ?? false,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      if (isSourceNumberTaken(error)) return { success: false, error: 'source_number_taken' };
      logError('Error creating client site:', error);
      return { success: false, error: 'create_failed' };
    }

    return { success: true, site: toClientSite(data) };
  } catch (error) {
    logError('Unexpected error in createClientSite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClientSite(
  rawSiteId: string,
  rawInput: Partial<SaveClientSiteInput> & { isActive?: boolean },
): Promise<ClientSiteResult> {
  const parsed = updateSiteArgumentsSchema.safeParse({ siteId: rawSiteId, input: rawInput });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { siteId, input } = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const changes: Record<string, Json> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) return { success: false, error: 'name_required' };
      changes.name = input.name.trim();
    }
    if (input.street !== undefined) changes.street = input.street?.trim() || null;
    if (input.postalCode !== undefined) changes.postal_code = input.postalCode?.trim() || null;
    if (input.city !== undefined) changes.city = input.city?.trim() || null;
    if (input.sourceNumber !== undefined) changes.source_number = input.sourceNumber?.trim() || null;
    if (input.accessNotes !== undefined) changes.access_notes = input.accessNotes?.trim() || null;
    if (input.notes !== undefined) changes.notes = input.notes?.trim() || null;
    if (input.primaryContactId !== undefined) changes.primary_contact_id = input.primaryContactId || null;
    if (input.isPrimary !== undefined) changes.is_primary = input.isPrimary;
    if (input.isActive !== undefined) changes.is_active = input.isActive;

    if (Object.keys(changes).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    // The function finds the site in the caller's organization and writes
    // one history entry per changed identity field and for archiving.
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('update_client_site', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_site_id: siteId,
      p_changes: changes,
    });
    if (isSourceNumberTaken(error)) return { success: false, error: 'source_number_taken' };
    if (error || !data) return masterWriteRefusal(error, 'update_failed', 'updateClientSite: save failed');

    return { success: true, site: toClientSite(data) };
  } catch (error) {
    logError('Unexpected error in updateClientSite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// Contacts and sites of one customer, for detail sections and work pickers.
// Manager-only: an assigned employee gets the site and contact of their own
// job through the job reader, never the customer's full list.
export async function getClientRelations(
  rawClientId: string,
  rawOptions?: { includeInactive?: boolean },
): Promise<ClientRelationsResult> {
  const parsed = clientRelationsArgumentsSchema.safeParse({ clientId: rawClientId, options: rawOptions });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { clientId, options } = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    let contactsQuery = admin
      .from('client_contacts')
      .select('*')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true });
    let sitesQuery = admin
      .from('client_sites')
      .select('*')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true });

    if (!options?.includeInactive) {
      contactsQuery = contactsQuery.eq('is_active', true);
      sitesQuery = sitesQuery.eq('is_active', true);
    }

    const [contactsResult, sitesResult] = await Promise.all([
      readCompleteRows((from, to) => contactsQuery.order('id').range(from, to), LIST_ROW_CAP),
      readCompleteRows((from, to) => sitesQuery.order('id').range(from, to), LIST_ROW_CAP),
    ]);

    if (contactsResult.error || sitesResult.error) {
      logError('Error fetching client relations:', contactsResult.error ?? sitesResult.error);
      return { success: false, error: 'fetch_failed' };
    }

    return {
      success: true,
      contacts: (contactsResult.data ?? []).map(toClientContact),
      sites: (sitesResult.data ?? []).map(toClientSite),
    };
  } catch (error) {
    logError('Unexpected error in getClientRelations:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
