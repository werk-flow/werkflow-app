import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';
import { BILLING_PARTY_SOURCES, type BillingWorkKind, type WorkBillingParties } from './types';

const versionSchema = z.object({
  id: z.string(),
  version: z.number(),
  source: z.enum(BILLING_PARTY_SOURCES),
  clientId: z.string(),
  clientName: z.string(),
  recipientClientId: z.string(),
  recipientName: z.string(),
  recipientAddress: z.string().nullable(),
  setAt: z.string(),
});

const accessContactSchema = z.object({ id: z.string(), name: z.string(), phone: z.string().nullable() });

const workBillingPartiesSchema = z.object({
  hasClient: z.boolean(),
  versions: z.array(versionSchema),
  site: z
    .object({
      id: z.string(),
      name: z.string(),
      street: z.string().nullable(),
      postalCode: z.string().nullable(),
      city: z.string().nullable(),
    })
    .nullable(),
  accessContacts: z.array(accessContactSchema),
});

/**
 * The versions of a job as its own read embeds them, so the job page gets
 * them without a request of its own (lab.office.job-open).
 */
export const JOB_BILLING_PARTIES_EMBED =
  'work_billing_parties(id, version, source, client_id, recipient_client_id, recipient_name, recipient_address, created_at, auftraggeber:clients!work_billing_parties_client_fk(name))';

/** The Objekt's contacts as the job's site read embeds them; only active access contacts count. */
export const SITE_CONTACTS_EMBED =
  'site_contacts:client_contacts!client_contacts_site_fk(id, name, phone, site_role, is_active)';

const embeddedVersionsSchema = z.array(
  z.object({
    id: z.string(),
    version: z.number(),
    source: z.enum(BILLING_PARTY_SOURCES),
    client_id: z.string(),
    recipient_client_id: z.string(),
    recipient_name: z.string(),
    recipient_address: z.string().nullable(),
    created_at: z.string(),
    auftraggeber: z.object({ name: z.string() }),
  }),
);

const embeddedContactsSchema = z.array(
  accessContactSchema.extend({ site_role: z.string().nullable(), is_active: z.boolean() }),
);

/**
 * The parties of a job from its own read: the embedded versions, the site it
 * already holds and the site's embedded contacts. Null when an embed is
 * malformed, so the section reads them itself.
 */
export function jobBillingPartiesFrom(input: {
  hasClient: boolean;
  versions: unknown;
  site: WorkBillingParties['site'];
  siteContacts: unknown;
}): WorkBillingParties | null {
  const versions = embeddedVersionsSchema.safeParse(input.versions);
  const contacts = embeddedContactsSchema.safeParse(input.siteContacts ?? []);
  if (!versions.success || !contacts.success) {
    logError('jobBillingPartiesFrom: embed malformed', versions.error ?? contacts.error);
    return null;
  }
  return {
    hasClient: input.hasClient,
    versions: versions.data
      .toSorted((a, b) => b.version - a.version)
      .map((row) => ({
        id: row.id,
        version: row.version,
        source: row.source,
        clientId: row.client_id,
        clientName: row.auftraggeber.name,
        recipientClientId: row.recipient_client_id,
        recipientName: row.recipient_name,
        recipientAddress: row.recipient_address,
        setAt: row.created_at,
      })),
    site: input.site,
    accessContacts: contacts.data
      .filter((contact) => contact.is_active && contact.site_role === 'zugangskontakt')
      .toSorted((a, b) => a.name.localeCompare(b.name, 'de'))
      .map(({ id, name, phone }) => ({ id, name, phone })),
  };
}

/**
 * The Auftraggeber and Rechnungsempfänger of one work with their history,
 * its Einsatzort and the Objekt's access contacts. Managers only: a field
 * worker never receives the recipient. Work outside the caller's
 * organization is work_not_found.
 */
export async function getWorkBillingParties(work: {
  kind: BillingWorkKind;
  id: string;
}): Promise<ActionResult<{ parties: WorkBillingParties }>> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

    const { data, error } = await createSupabaseAdminClient().rpc('get_work_billing_parties', {
      p_organization_id: auth.context.orgId,
      p_kind: work.kind,
      p_work_id: work.id,
    });
    if (error) {
      logReadFailure('getWorkBillingParties: read failed', error);
      return { success: false, error: 'load_failed' };
    }
    if (data === null) return { success: false, error: 'work_not_found' };
    const parties = workBillingPartiesSchema.safeParse(data);
    if (!parties.success) {
      logError('getWorkBillingParties: read malformed', parties.error);
      return { success: false, error: 'load_failed' };
    }
    return { success: true, parties: parties.data };
  } catch (error) {
    logError('Unexpected error in getWorkBillingParties:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
