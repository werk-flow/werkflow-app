import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { validateSiteAndContactForClient } from '@/lib/clients/site-contact-validation';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import type { z } from '@/lib/zod';
import type { updateProjectArgumentsSchema } from './action-schemas';

/** A project edit after the boundary parse. */
type ProjectUpdateChanges = z.output<typeof updateProjectArgumentsSchema>['input'];

/** The project columns the edit changes, as `update_project_with_jobs` takes them. */
function projectChangeColumns(
  input: ProjectUpdateChanges,
  customer: { clientChanged: boolean; resultingSiteId: string | null; resultingContactId: string | null },
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.description !== undefined) updateData.description = input.description?.trim() || null;
  if (input.clientId !== undefined) updateData.client_id = input.clientId || null;
  if (input.siteId !== undefined || customer.clientChanged) updateData.site_id = customer.resultingSiteId;
  if (input.contactId !== undefined || customer.clientChanged)
    updateData.contact_id = customer.resultingContactId;
  if (input.projectNumber !== undefined) updateData.project_number = input.projectNumber?.trim() || null;
  if (input.plannedStartDate !== undefined) updateData.planned_start_date = input.plannedStartDate || null;
  if (input.plannedEndDate !== undefined) updateData.planned_end_date = input.plannedEndDate || null;
  return updateData;
}

/**
 * Checks a project edit against the stored project and returns the changed
 * columns for `update_project_with_jobs`. It writes nothing. The caller has
 * established the actor's right to edit projects of the organization.
 */
export async function prepareProjectUpdate(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  input: ProjectUpdateChanges,
): Promise<{ success: true; changes: Record<string, unknown> } | ActionFailure> {
  const { data: existing, error: fetchError } = await admin
    .from('projects')
    .select('id, client_id, site_id, contact_id, name, description')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'project_not_found' };
  }

  const resultingName = input.name !== undefined ? input.name.trim() : existing.name.trim();
  const resultingDescription =
    input.description !== undefined
      ? (input.description?.trim() ?? '')
      : (existing.description?.trim() ?? '');

  if (!resultingName && !resultingDescription) {
    return { success: false, error: 'name_or_description_required' };
  }

  if (input.clientId !== undefined && input.clientId) {
    const { data: client, error: clientError } = await admin
      .from('clients')
      .select('id')
      .eq('id', input.clientId)
      .eq('organization_id', orgId)
      .single();

    if (clientError || !client) {
      return { success: false, error: 'client_not_found' };
    }
  }

  if (input.projectNumber !== undefined && input.projectNumber?.trim()) {
    const { data: numberConflict, error: numberConflictError } = await loggedRead(
      'updateProject: projects read failed',
      admin
        .from('projects')
        .select('id')
        .eq('organization_id', orgId)
        .eq('project_number', input.projectNumber.trim())
        .neq('id', projectId)
        .maybeSingle(),
    );
    if (numberConflictError) return { success: false, error: 'load_failed' };

    if (numberConflict) {
      return { success: false, error: 'project_number_taken' };
    }
  }

  const resultingClientId = input.clientId !== undefined ? input.clientId || null : existing.client_id;
  const clientChanged = resultingClientId !== existing.client_id;

  // A customer change invalidates the previous customer's site/contact.
  const resultingSiteId =
    input.siteId !== undefined ? input.siteId || null : clientChanged ? null : existing.site_id;
  const resultingContactId =
    input.contactId !== undefined ? input.contactId || null : clientChanged ? null : existing.contact_id;

  if (input.siteId !== undefined || input.contactId !== undefined || clientChanged) {
    const siteContactCheck = await validateSiteAndContactForClient(
      admin,
      orgId,
      resultingClientId,
      resultingSiteId,
      resultingContactId,
    );
    if (!siteContactCheck.success) {
      return siteContactCheck;
    }
  }

  const updateData = projectChangeColumns(input, { clientChanged, resultingSiteId, resultingContactId });

  if (Object.keys(updateData).length === 0) {
    return { success: false, error: 'no_changes' };
  }
  return { success: true, changes: updateData };
}
