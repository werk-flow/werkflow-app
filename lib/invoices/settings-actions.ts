'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { saveInvoiceSettingsSchema, type SaveInvoiceSettingsInput } from './settings';

const refusal = writeRefusalFor(new Set(['not_authorized', 'stale_version', 'invoice_year_changed']));

/**
 * Saves the organization's invoice settings, Admin only. Once an invoice is
 * issued the series stays as it is and only the default terms change.
 */
export async function saveInvoiceSettings(
  rawInput: SaveInvoiceSettingsInput,
): Promise<ActionResult<{ version: number }>> {
  const parsed = saveInvoiceSettingsSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const caller = await resolveActionContext();
    if (!caller.success) return caller;
    if (caller.context.orgId !== parsed.data.organizationId) {
      return { success: false, error: 'organization_changed' };
    }
    if (caller.context.role !== 'admin') return { success: false, error: 'not_authorized' };
    const { data, error } = await createSupabaseAdminClient().rpc('save_invoice_settings', {
      p_actor_id: caller.context.userId,
      p_organization_id: caller.context.orgId,
      p_expected_version: parsed.data.expectedVersion,
      p_settings: parsed.data.settings,
    });
    if (error || data === null) {
      return refusal(error, 'save_failed', 'saveInvoiceSettings: save_invoice_settings failed');
    }
    revalidatePath('/einstellungen/rechnungen');
    return { success: true, version: data };
  } catch (error) {
    logError('saveInvoiceSettings: unexpected error', error);
    return { success: false, error: 'unexpected_error' };
  }
}
