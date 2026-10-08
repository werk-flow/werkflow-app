'use server';

import type { ActionResult } from '@/lib/action-result';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { requireManagerAndClient } from '@/lib/clients/manager-access';
import {
  type Client,
  type ClientType,
  type CreateClientResult,
  type UpdateClientResult,
  type DeleteClientResult,
  toClient,
} from '@/lib/jobs/types';
import {
  type ClientContactResult,
  type ClientRelationsResult,
  type ClientSiteResult,
  toClientContact,
  toClientSite,
} from '@/lib/clients/types';
import { logError } from '@/lib/logging';
import { Constants } from '@/lib/supabase/database.types';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// ============================================
// Input Types
// ============================================

export type CreateClientInput = {
  name: string;
  clientType: ClientType;
  customerNumber?: string;
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
  email: nullableClientText(320),
  phone: nullableClientText(100),
  address: nullableClientText(1000),
  notes: nullableClientText(10000),
});

const updateClientArgumentsSchema = z.object({ clientId: uuidSchema, input: clientFieldsSchema.partial() });

const contactFieldsSchema = z.object({
  name: z.string().max(300),
  role: nullableClientText(200),
  email: nullableClientText(320),
  phone: nullableClientText(100),
  notes: nullableClientText(10000),
  isPrimary: z.boolean().optional(),
});

const siteFieldsSchema = z.object({
  name: z.string().max(300),
  street: nullableClientText(300),
  postalCode: nullableClientText(20),
  city: nullableClientText(200),
  accessNotes: nullableClientText(10000),
  notes: nullableClientText(10000),
  primaryContactId: uuidSchema.or(z.literal('')).nullish(),
  isPrimary: z.boolean().optional(),
});

const createContactArgumentsSchema = z.object({ clientId: uuidSchema, input: contactFieldsSchema });
const updateContactArgumentsSchema = z.object({
  contactId: uuidSchema,
  input: contactFieldsSchema.partial().extend({ isActive: z.boolean().optional() }),
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

// ============================================
// Actions
// ============================================

export async function createClient(rawInput: CreateClientInput): Promise<CreateClientResult> {
  const parsed = clientFieldsSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
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

    const { data, error } = await admin
      .from('clients')
      .insert({
        organization_id: orgId,
        name: input.name.trim(),
        client_type: input.clientType,
        customer_number: input.customerNumber?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single();

    if (error || !data) {
      logError('Error creating client:', error);
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
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116')
      logReadFailure('updateClient: client read failed', fetchError);
    if (fetchError || !existing) {
      return { success: false, error: 'client_not_found' };
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.clientType !== undefined) updateData.client_type = input.clientType;
    if (input.customerNumber !== undefined) updateData.customer_number = input.customerNumber?.trim() || null;
    if (input.email !== undefined) updateData.email = input.email?.trim() || null;
    if (input.phone !== undefined) updateData.phone = input.phone?.trim() || null;
    if (input.address !== undefined) updateData.address = input.address?.trim() || null;
    if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null;

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    const { data, error } = await admin
      .from('clients')
      .update(updateData)
      .eq('id', clientId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error || !data) {
      logError('Error updating client:', error);
      if (error?.code === '23505') {
        return { success: false, error: 'customer_number_taken' };
      }
      return { success: false, error: 'update_failed' };
    }

    return { success: true, client: toClient(data) };
  } catch (error) {
    logError('Unexpected error in updateClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteClient(rawClientId: string): Promise<DeleteClientResult> {
  const parsedClientId = uuidSchema.safeParse(rawClientId);
  if (!parsedClientId.success) return { success: false, error: 'invalid_input' };
  const clientId = parsedClientId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116')
      logReadFailure('deleteClient: client read failed', fetchError);
    if (fetchError || !existing) {
      return { success: false, error: 'client_not_found' };
    }

    const { error } = await admin.from('clients').delete().eq('id', clientId).eq('organization_id', orgId);

    if (error) {
      logError('Error deleting client:', error);
      return { success: false, error: 'delete_failed' };
    }

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getClientDetail(rawClientId: string): Promise<ActionResult<{ client: Client }>> {
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

    return { success: true, client: toClient(data) };
  } catch (error) {
    logError('Unexpected error in getClientDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Contacts And Work Sites
// ============================================

export type SaveClientContactInput = {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
  isPrimary?: boolean;
};

export type SaveClientSiteInput = {
  name: string;
  street?: string;
  postalCode?: string;
  city?: string;
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
    const { data, error } = await admin
      .from('client_contacts')
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: input.name.trim(),
        role: input.role?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        notes: input.notes?.trim() || null,
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
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const { data: existing, error: fetchError } = await admin
      .from('client_contacts')
      .select('id, client_id')
      .eq('id', contactId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116')
      logReadFailure('updateClientContact: contact read failed', fetchError);
    if (fetchError || !existing) {
      return { success: false, error: 'contact_not_found' };
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) return { success: false, error: 'name_required' };
      updateData.name = input.name.trim();
    }
    if (input.role !== undefined) updateData.role = input.role?.trim() || null;
    if (input.email !== undefined) updateData.email = input.email?.trim() || null;
    if (input.phone !== undefined) updateData.phone = input.phone?.trim() || null;
    if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null;
    if (input.isPrimary !== undefined) updateData.is_primary = input.isPrimary;
    if (input.isActive !== undefined) updateData.is_active = input.isActive;

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    const { data, error } = await admin
      .from('client_contacts')
      .update(updateData)
      .eq('id', contactId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error || !data) {
      logError('Error updating client contact:', error);
      return { success: false, error: 'update_failed' };
    }

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
        access_notes: input.accessNotes?.trim() || null,
        notes: input.notes?.trim() || null,
        primary_contact_id: input.primaryContactId || null,
        is_primary: input.isPrimary ?? false,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
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
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const { data: existing, error: fetchError } = await admin
      .from('client_sites')
      .select('id, client_id')
      .eq('id', siteId)
      .eq('organization_id', orgId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116')
      logReadFailure('updateClientSite: site read failed', fetchError);
    if (fetchError || !existing) {
      return { success: false, error: 'site_not_found' };
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) return { success: false, error: 'name_required' };
      updateData.name = input.name.trim();
    }
    if (input.street !== undefined) updateData.street = input.street?.trim() || null;
    if (input.postalCode !== undefined) updateData.postal_code = input.postalCode?.trim() || null;
    if (input.city !== undefined) updateData.city = input.city?.trim() || null;
    if (input.accessNotes !== undefined) updateData.access_notes = input.accessNotes?.trim() || null;
    if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null;
    if (input.primaryContactId !== undefined) updateData.primary_contact_id = input.primaryContactId || null;
    if (input.isPrimary !== undefined) updateData.is_primary = input.isPrimary;
    if (input.isActive !== undefined) updateData.is_active = input.isActive;

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    const { data, error } = await admin
      .from('client_sites')
      .update(updateData)
      .eq('id', siteId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error || !data) {
      logError('Error updating client site:', error);
      return { success: false, error: 'update_failed' };
    }

    return { success: true, site: toClientSite(data) };
  } catch (error) {
    logError('Unexpected error in updateClientSite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// Contacts and sites of one customer, for detail sections and work pickers.
// Managers see everything; employees may load relations only for customers
// of jobs they are assigned to (the job page needs site/contact context).
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
    const { orgId, userId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    if (!isManagerOrAbove) {
      const { data: assignedJob, error: assignedJobError } = await admin
        .from('jobs')
        .select('id, job_assignments!inner(user_id)')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('job_assignments.user_id', userId)
        .limit(1)
        .maybeSingle();

      if (assignedJobError) logReadFailure('getClientRelations: assigned job read failed', assignedJobError);
      if (!assignedJob) {
        return { success: false, error: 'not_authorized' };
      }
    }

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
