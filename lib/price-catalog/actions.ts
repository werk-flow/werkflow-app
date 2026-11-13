'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import {
  addLeistungPriceSchema,
  createLeistungSchema,
  setLeistungArchivedSchema,
  updateLeistungSchema,
  type AddLeistungPriceInput,
  type CreateLeistungInput,
  type SetLeistungArchivedInput,
  type UpdateLeistungInput,
} from './action-schemas';

// Admin and Büro keep the Leistungen. Every action resolves the caller's
// organization and manager role on the server and writes only inside it;
// the tables have no client grant (supabase/migrations/20261201180000_keep_dated_leistung_prices.sql).

const LEISTUNGEN_PATH = '/angebote/leistungen';

// The refusals create_leistung and add_leistung_price raise.
const createRefusal = writeRefusalFor(new Set(['leistung_number_taken']));
const priceRefusal = writeRefusalFor(new Set(['leistung_not_found']));

/** The caller in the active organization, refused unless Admin or Büro. */
async function resolveManager() {
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' as const };
  return caller;
}

/** Creates a Leistung with its first price in one database call. */
export async function createLeistung(
  rawInput: CreateLeistungInput,
): Promise<ActionResult<{ leistungId: string }>> {
  const parsed = createLeistungSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManager();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(
      'create_leistung',
      rpcArgs('create_leistung', {
        p_organization_id: orgId,
        p_actor_id: userId,
        p_leistung_number: input.leistungNumber,
        p_name: input.name,
        p_description: input.description,
        p_kind: input.kind,
        p_unit: input.unit,
        p_tax_rate_basis_points: input.taxRateBasisPoints,
        p_valid_from: input.validFrom,
        p_sale_price_cents: input.salePriceCents,
        p_cost_rate_cents: input.costRateCents,
      }),
    );
    if (error || !data) return createRefusal(error, 'save_failed', 'createLeistung: create_leistung failed');
    revalidatePath(LEISTUNGEN_PATH);
    return { success: true, leistungId: data };
  } catch (error) {
    logError('createLeistung: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Changes number, name, description, kind, unit and tax rate of an active Leistung; its prices stay. */
export async function updateLeistung(rawInput: UpdateLeistungInput): Promise<ActionResult> {
  const parsed = updateLeistungSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManager();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('leistungen')
      .update({
        leistung_number: input.leistungNumber,
        name: input.name,
        description: input.description,
        kind: input.kind,
        unit: input.unit,
        tax_rate_basis_points: input.taxRateBasisPoints,
        updated_by: userId,
      })
      .eq('organization_id', orgId)
      .eq('id', input.leistungId)
      .is('archived_at', null)
      .select('id');
    if (error?.code === '23505') return { success: false, error: 'leistung_number_taken' };
    if (error) {
      logError('updateLeistung: update failed', error);
      return { success: false, error: 'save_failed' };
    }
    if (data.length === 0) return { success: false, error: 'leistung_not_found' };
    revalidatePath(LEISTUNGEN_PATH);
    return { success: true };
  } catch (error) {
    logError('updateLeistung: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Records a price from its first day on. Earlier versions stay as they are; a
 * second price for the same first day replaces the first one for every later
 * read and keeps it as history.
 */
export async function addLeistungPrice(rawInput: AddLeistungPriceInput): Promise<ActionResult> {
  const parsed = addLeistungPriceSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManager();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    // The function locks the Leistung, so an archive in between waits or wins before the insert.
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(
      'add_leistung_price',
      rpcArgs('add_leistung_price', {
        p_organization_id: orgId,
        p_actor_id: userId,
        p_leistung_id: input.leistungId,
        p_valid_from: input.validFrom,
        p_sale_price_cents: input.salePriceCents,
        p_cost_rate_cents: input.costRateCents,
      }),
    );
    if (error || !data)
      return priceRefusal(error, 'save_failed', 'addLeistungPrice: add_leistung_price failed');
    revalidatePath(LEISTUNGEN_PATH);
    return { success: true };
  } catch (error) {
    logError('addLeistungPrice: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Archives or restores a Leistung. A repeat of the recorded state succeeds. */
export async function setLeistungArchived(rawInput: SetLeistungArchivedInput): Promise<ActionResult> {
  const parsed = setLeistungArchivedSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const caller = await resolveManager();
    if (!caller.success) return caller;
    const { orgId, userId } = caller.context;
    const admin = createSupabaseAdminClient();
    const changed = admin
      .from('leistungen')
      .update({ archived_at: input.archived ? new Date().toISOString() : null, updated_by: userId })
      .eq('organization_id', orgId)
      .eq('id', input.leistungId);
    // Only a Leistung in the other state changes, so a repeat keeps the first archive time.
    const { data, error } = await (
      input.archived ? changed.is('archived_at', null) : changed.not('archived_at', 'is', null)
    ).select('id');
    if (error) {
      logError('setLeistungArchived: update failed', error);
      return { success: false, error: 'save_failed' };
    }
    if (data.length === 0) {
      const existing = await admin
        .from('leistungen')
        .select('id')
        .eq('organization_id', orgId)
        .eq('id', input.leistungId)
        .maybeSingle();
      if (existing.error) {
        logError('setLeistungArchived: leistung read failed', existing.error);
        return { success: false, error: 'load_failed' };
      }
      if (!existing.data) return { success: false, error: 'leistung_not_found' };
      // Another session already made the change: this caller's view still needs the new state.
      revalidatePath(LEISTUNGEN_PATH);
      return { success: true };
    }
    revalidatePath(LEISTUNGEN_PATH);
    return { success: true };
  } catch (error) {
    logError('setLeistungArchived: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
