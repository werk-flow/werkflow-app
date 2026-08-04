'use server';

import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
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

// ============================================
// Actions
// ============================================

export async function createClient(
  input: CreateClientInput
): Promise<CreateClientResult> {
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
      console.error('Error creating client:', error);
      if (error?.code === '23505') {
        return { success: false, error: 'customer_number_taken' };
      }
      return { success: false, error: 'create_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));

    return { success: true, client: toClient(data) };
  } catch (error) {
    console.error('Unexpected error in createClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClient(
  clientId: string,
  input: UpdateClientInput
): Promise<UpdateClientResult> {
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

    if (fetchError || !existing) {
      return { success: false, error: 'client_not_found' };
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.clientType !== undefined) updateData.client_type = input.clientType;
    if (input.customerNumber !== undefined)
      updateData.customer_number = input.customerNumber?.trim() || null;
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
      console.error('Error updating client:', error);
      if (error?.code === '23505') {
        return { success: false, error: 'customer_number_taken' };
      }
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));

    return { success: true, client: toClient(data) };
  } catch (error) {
    console.error('Unexpected error in updateClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteClient(
  clientId: string
): Promise<DeleteClientResult> {
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

    if (fetchError || !existing) {
      return { success: false, error: 'client_not_found' };
    }

    const { error } = await admin
      .from('clients')
      .delete()
      .eq('id', clientId)
      .eq('organization_id', orgId);

    if (error) {
      console.error('Error deleting client:', error);
      return { success: false, error: 'delete_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));
    updateTag(CACHE_TAGS.jobs(orgId));
    updateTag(CACHE_TAGS.projects(orgId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getClientDetail(
  clientId: string
): Promise<
  { success: true; client: Client } | { success: false; error: string }
> {
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

    if (error || !data) {
      return { success: false, error: 'not_found' };
    }

    return { success: true, client: toClient(data) };
  } catch (error) {
    console.error('Unexpected error in getClientDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Contacts And Work Sites (P1-01)
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

type ManagerContext = { orgId: string; userId: string };

async function requireManagerAndClient(
  clientId: string
): Promise<
  | { success: true; context: ManagerContext }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;

  if (!isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const { data: client, error } = await admin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .single();

  if (error || !client) {
    return { success: false, error: 'client_not_found' };
  }

  return { success: true, context: { orgId, userId } };
}

// Only one contact/site per customer carries the primary marker.
async function clearPrimaryFlag(
  table: 'client_contacts' | 'client_sites',
  orgId: string,
  clientId: string
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(table)
    .update({ is_primary: false })
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('is_primary', true);

  if (error) {
    console.error(`Error clearing primary flag on ${table}:`, error);
  }
}

export async function createClientContact(
  clientId: string,
  input: SaveClientContactInput
): Promise<ClientContactResult> {
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;

    if (!input.name.trim()) {
      return { success: false, error: 'name_required' };
    }

    if (input.isPrimary) {
      await clearPrimaryFlag('client_contacts', orgId, clientId);
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
      console.error('Error creating client contact:', error);
      return { success: false, error: 'create_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));
    return { success: true, contact: toClientContact(data) };
  } catch (error) {
    console.error('Unexpected error in createClientContact:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClientContact(
  contactId: string,
  input: Partial<SaveClientContactInput> & { isActive?: boolean }
): Promise<ClientContactResult> {
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

    if (fetchError || !existing) {
      return { success: false, error: 'contact_not_found' };
    }

    if (input.isPrimary) {
      await clearPrimaryFlag('client_contacts', orgId, existing.client_id);
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
      console.error('Error updating client contact:', error);
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));
    return { success: true, contact: toClientContact(data) };
  } catch (error) {
    console.error('Unexpected error in updateClientContact:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function createClientSite(
  clientId: string,
  input: SaveClientSiteInput
): Promise<ClientSiteResult> {
  try {
    const auth = await requireManagerAndClient(clientId);
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;

    if (!input.name.trim()) {
      return { success: false, error: 'name_required' };
    }

    if (input.isPrimary) {
      await clearPrimaryFlag('client_sites', orgId, clientId);
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
      console.error('Error creating client site:', error);
      return { success: false, error: 'create_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));
    return { success: true, site: toClientSite(data) };
  } catch (error) {
    console.error('Unexpected error in createClientSite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClientSite(
  siteId: string,
  input: Partial<SaveClientSiteInput> & { isActive?: boolean }
): Promise<ClientSiteResult> {
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

    if (fetchError || !existing) {
      return { success: false, error: 'site_not_found' };
    }

    if (input.isPrimary) {
      await clearPrimaryFlag('client_sites', orgId, existing.client_id);
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) return { success: false, error: 'name_required' };
      updateData.name = input.name.trim();
    }
    if (input.street !== undefined) updateData.street = input.street?.trim() || null;
    if (input.postalCode !== undefined)
      updateData.postal_code = input.postalCode?.trim() || null;
    if (input.city !== undefined) updateData.city = input.city?.trim() || null;
    if (input.accessNotes !== undefined)
      updateData.access_notes = input.accessNotes?.trim() || null;
    if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null;
    if (input.primaryContactId !== undefined)
      updateData.primary_contact_id = input.primaryContactId || null;
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
      console.error('Error updating client site:', error);
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.clients(orgId));
    return { success: true, site: toClientSite(data) };
  } catch (error) {
    console.error('Unexpected error in updateClientSite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// Contacts and sites of one customer, for detail sections and work pickers.
// Managers see everything; employees may load relations only for customers
// of jobs they are assigned to (the job page needs site/contact context).
export async function getClientRelations(
  clientId: string,
  options?: { includeInactive?: boolean }
): Promise<ClientRelationsResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    if (!isManagerOrAbove) {
      const { data: assignedJob } = await admin
        .from('jobs')
        .select('id, job_assignments!inner(user_id)')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('job_assignments.user_id', userId)
        .limit(1)
        .maybeSingle();

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
      contactsQuery,
      sitesQuery,
    ]);

    if (contactsResult.error || sitesResult.error) {
      console.error(
        'Error fetching client relations:',
        contactsResult.error ?? sitesResult.error
      );
      return { success: false, error: 'fetch_failed' };
    }

    return {
      success: true,
      contacts: (contactsResult.data ?? []).map(toClientContact),
      sites: (sitesResult.data ?? []).map(toClientSite),
    };
  } catch (error) {
    console.error('Unexpected error in getClientRelations:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getOrgClients(): Promise<
  { success: true; clients: Client[] } | { success: false; error: string }
> {
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
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching clients:', error);
      return { success: false, error: 'fetch_failed' };
    }

    return { success: true, clients: (data ?? []).map(toClient) };
  } catch (error) {
    console.error('Unexpected error in getOrgClients:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
