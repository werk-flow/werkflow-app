import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { invoiceSettingsSchema, type InvoiceSettings } from './settings';

/**
 * The organization's invoice settings; the page authorizes Admin or Büro and
 * resolves the organization first. A failed read throws.
 */
export async function readInvoiceSettings(organizationId: string): Promise<InvoiceSettings> {
  const selected = await createSupabaseAdminClient().rpc('get_invoice_settings', {
    p_organization_id: organizationId,
  });
  const parsed = invoiceSettingsSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('invoice_settings_read_failed');
  return parsed.data;
}
