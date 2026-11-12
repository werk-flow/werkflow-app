import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';
import {
  BILLING_PARTY_SOURCES,
  type BillingRecipient,
  type BillingWorkKind,
  type WorkBillingParties,
} from './types';

const versionSchema = z.object({
  version: z.number(),
  source: z.enum(BILLING_PARTY_SOURCES),
  setAt: z.string(),
  auftraggeber: z.object({ id: z.string(), name: z.string() }),
  recipient: z.object({ id: z.string(), name: z.string(), address: z.string().nullable() }),
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
  'work_billing_parties(version, source, client_id, recipient_client_id, recipient_name, recipient_address, created_at, auftraggeber:clients!work_billing_parties_client_fk(name))';

/** The Objekt's contacts as the job's site read embeds them; only active access contacts count. */
export const SITE_CONTACTS_EMBED =
  'site_contacts:client_contacts!client_contacts_site_fk(id, name, phone, site_role, is_active)';

const embeddedVersionsSchema = z.array(
  z.object({
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
 * The parties of a job from its own read: the embedded versions and the
 * site's embedded contacts. A party that is the job's customer, as the job
 * read already returns it, is left out (lab.office.job-open). Null when an
 * embed is malformed, so the section reads them itself.
 */
export function jobBillingPartiesFrom(input: {
  workClient: BillingRecipient | null;
  versions: unknown;
  siteContacts: unknown;
}): WorkBillingParties | null {
  const { workClient } = input;
  const versions = embeddedVersionsSchema.safeParse(input.versions);
  const contacts = embeddedContactsSchema.safeParse(input.siteContacts ?? []);
  if (!versions.success || !contacts.success) {
    logError('jobBillingPartiesFrom: embed malformed', versions.error ?? contacts.error);
    return null;
  }
  return {
    hasClient: workClient !== null,
    versions: versions.data
      .toSorted((a, b) => b.version - a.version)
      .map((row) => ({
        version: row.version,
        source: row.source,
        setAt: row.created_at,
        auftraggeber:
          row.client_id === workClient?.id ? null : { id: row.client_id, name: row.auftraggeber.name },
        recipient:
          row.recipient_client_id === workClient?.id &&
          row.recipient_name === workClient.name &&
          row.recipient_address === workClient.address
            ? null
            : { id: row.recipient_client_id, name: row.recipient_name, address: row.recipient_address },
      })),
    // The job page passes the site the job carries.
    site: null,
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
