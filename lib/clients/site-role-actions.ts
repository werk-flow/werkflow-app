'use server';

import type { ActionResult } from '@/lib/action-result';
import { formatSiteRowAddress } from '@/lib/clients/types';
import { requireManagerAndClient } from '@/lib/clients/manager-access';
import {
  clientSiteRoleRowSchema,
  siteRoleDateSchema,
  siteRoleKindSchema,
  type ClientSiteRole,
} from '@/lib/clients/site-roles';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The refusals assign_client_site_role and end_client_site_role raise
// (supabase/migrations/20261130090003_record_dated_objekt_roles.sql).
const roleWriteRefusal = writeRefusalFor(
  new Set([
    'not_authorized',
    'client_not_found',
    'site_not_found',
    'holder_not_found',
    'holder_archived',
    'holder_unchanged',
    'role_starts_before_current',
    'role_overlaps',
    'role_not_found',
    'role_already_ended',
    'role_ends_before_start',
  ]),
);

const assignArgumentsSchema = z
  .object({
    siteId: uuidSchema,
    role: siteRoleKindSchema,
    holderClientId: uuidSchema,
    startsOn: siteRoleDateSchema.nullable(),
    // Ends the open role of this kind the day before startsOn.
    replace: z.boolean(),
  })
  .refine((input) => !input.replace || input.startsOn !== null);

const endArgumentsSchema = z.object({ roleId: uuidSchema, endsOn: siteRoleDateSchema });

type AssignClientSiteRoleInput = z.input<typeof assignArgumentsSchema>;
type EndClientSiteRoleInput = z.input<typeof endArgumentsSchema>;

/**
 * Every role on the customer's own Objekte and every role it holds on
 * another customer's Objekt, ended ones included. Manager-only.
 */
export async function getClientSiteRoles(
  rawClientId: string,
): Promise<ActionResult<{ roles: ClientSiteRole[] }>> {
  const clientId = uuidSchema.safeParse(rawClientId);
  if (!clientId.success) return { success: false, error: 'invalid_input' };
  try {
    const auth = await requireManagerAndClient(clientId.data);
    if (!auth.success) return auth;
    const { orgId, admin } = auth.context;
    const result = await readCompleteRows(
      (from, to) =>
        admin
          .rpc('list_client_site_roles', { p_organization_id: orgId, p_client_id: clientId.data })
          .range(from, to),
      LIST_ROW_CAP,
    );
    const rows = z.array(clientSiteRoleRowSchema).safeParse(result.data);
    if (result.error || !rows.success) {
      logError('getClientSiteRoles: read failed', result.error ?? rows.error);
      return { success: false, error: 'load_failed' };
    }
    const roles: ClientSiteRole[] = [];
    for (const row of rows.data) {
      const role = siteRoleKindSchema.safeParse(row.role);
      if (!role.success) continue;
      roles.push({
        id: row.id,
        siteId: row.site_id,
        siteName: row.site_name,
        siteAddress: formatSiteRowAddress({
          street: row.site_street,
          postal_code: row.site_postal_code,
          city: row.site_city,
        }),
        siteSourceNumber: row.site_source_number,
        siteIsActive: row.site_is_active,
        siteClientId: row.site_client_id,
        siteClientName: row.site_client_name,
        holderClientId: row.holder_client_id,
        holderName: row.holder_name,
        holderArchived: row.holder_archived_at !== null,
        role: role.data,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
      });
    }
    return { success: true, roles };
  } catch (error) {
    logError('Unexpected error in getClientSiteRoles:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Records a role on an Objekt. With `replace`, the open role of that kind
 * ends the day before in the same database call: a change of owner,
 * Hausverwaltung or Rechnungsempfänger.
 */
export async function assignClientSiteRole(
  rawInput: AssignClientSiteRoleInput,
): Promise<ActionResult<{ roleId: string }>> {
  const parsed = assignArgumentsSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

    // The function finds the Objekt and the holder in the caller's
    // organization and checks the caller's role again under its lock.
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('assign_client_site_role', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_site_id: input.siteId,
      p_role: input.role,
      p_holder_client_id: input.holderClientId,
      // An unknown start leaves p_starts_on at its default, null.
      ...(input.startsOn === null ? {} : { p_starts_on: input.startsOn }),
      p_replace: input.replace,
    });
    if (error || !data) return roleWriteRefusal(error, 'save_failed', 'assignClientSiteRole: save failed');
    return { success: true, roleId: data.id };
  } catch (error) {
    logError('Unexpected error in assignClientSiteRole:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Ends a role on its last day; the role stays as history. */
export async function endClientSiteRole(rawInput: EndClientSiteRoleInput): Promise<ActionResult> {
  const parsed = endArgumentsSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('end_client_site_role', {
      p_actor_id: userId,
      p_organization_id: orgId,
      p_role_id: input.roleId,
      p_ends_on: input.endsOn,
    });
    if (error || !data) return roleWriteRefusal(error, 'save_failed', 'endClientSiteRole: save failed');
    return { success: true };
  } catch (error) {
    logError('Unexpected error in endClientSiteRole:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
