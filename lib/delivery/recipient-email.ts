import 'server-only';

import { loggedRead } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { recipientSchema } from './delivery-types';

// The address a send form proposes for a customer (E10's records): a named
// contact's email first, when the work names one, then the customer's own,
// then the customer's active main contact's. Empty when none holds one
// address; the office types it then.

/** The first usable address of the contact, the customer and its main contact; a failed read throws. */
export async function readRecipientEmail(
  organizationId: string,
  party: { clientId: string; contactId?: string | null },
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const [named, client, contact] = await Promise.all([
    party.contactId
      ? loggedRead(
          'readRecipientEmail: named contact read failed',
          admin
            .from('client_contacts')
            .select('email')
            .eq('organization_id', organizationId)
            .eq('client_id', party.clientId)
            .eq('id', party.contactId)
            .eq('is_active', true)
            .maybeSingle(),
        )
      : { data: null, error: null },
    loggedRead(
      'readRecipientEmail: client read failed',
      admin
        .from('clients')
        .select('email')
        .eq('organization_id', organizationId)
        .eq('id', party.clientId)
        .maybeSingle(),
    ),
    loggedRead(
      'readRecipientEmail: contact read failed',
      admin
        .from('client_contacts')
        .select('email')
        .eq('organization_id', organizationId)
        .eq('client_id', party.clientId)
        .eq('is_active', true)
        .eq('is_primary', true)
        .is('site_id', null)
        .not('email', 'is', null)
        .order('created_at')
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  if (named.error || client.error || contact.error) throw new Error('recipient_email_read_failed');
  for (const candidate of [named.data?.email, client.data?.email, contact.data?.email]) {
    const parsed = recipientSchema.safeParse(candidate?.trim());
    if (parsed.success) return parsed.data;
  }
  return '';
}
