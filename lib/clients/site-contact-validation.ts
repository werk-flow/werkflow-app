import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';

type SiteContactValidationError =
  | 'site_requires_client'
  | 'site_not_found'
  | 'site_client_mismatch'
  | 'contact_requires_client'
  | 'contact_not_found'
  | 'contact_client_mismatch';

export type SiteContactValidationResult = ActionResult<object, SiteContactValidationError>;

// A job or project may only reference a site/contact that belongs to its own
// customer (and organization). Called by the jobs/projects server actions
// before writing site_id/contact_id.
export async function validateSiteAndContactForClient(
  admin: AdminClient,
  orgId: string,
  clientId: string | null,
  siteId: string | null,
  contactId: string | null,
): Promise<SiteContactValidationResult> {
  if (siteId) {
    if (!clientId) {
      return { success: false, error: 'site_requires_client' };
    }
    const { data: site, error } = await admin
      .from('client_sites')
      .select('id, client_id')
      .eq('id', siteId)
      .eq('organization_id', orgId)
      .single();

    if (error && error.code !== 'PGRST116')
      logReadFailure('validateSiteAndContactForClient: site read failed', error);
    if (error || !site) {
      return { success: false, error: 'site_not_found' };
    }
    if (site.client_id !== clientId) {
      return { success: false, error: 'site_client_mismatch' };
    }
  }

  if (contactId) {
    if (!clientId) {
      return { success: false, error: 'contact_requires_client' };
    }
    const { data: contact, error } = await admin
      .from('client_contacts')
      .select('id, client_id')
      .eq('id', contactId)
      .eq('organization_id', orgId)
      .single();

    if (error && error.code !== 'PGRST116')
      logReadFailure('validateSiteAndContactForClient: contact read failed', error);
    if (error || !contact) {
      return { success: false, error: 'contact_not_found' };
    }
    if (contact.client_id !== clientId) {
      return { success: false, error: 'contact_client_mismatch' };
    }
  }

  return { success: true };
}
