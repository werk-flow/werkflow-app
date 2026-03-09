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

// ============================================
// Input Types
// ============================================

export type CreateClientInput = {
  name: string;
  clientType: ClientType;
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
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating client:', error);
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
