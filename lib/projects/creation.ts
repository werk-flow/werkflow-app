import type { Json } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import type { z } from '@/lib/zod';
import { CUSTOMER_REFERENCE_REFUSALS } from '@/lib/jobs/write-refusals';
import type { createProjectInputSchema } from './action-schemas';

/** The refusals of app_private.create_project_record, each an action failure code. */
export const PROJECT_CREATION_REFUSALS = [
  'invalid_input',
  'name_or_description_required',
  'project_number_required',
  'project_number_taken',
  ...CUSTOMER_REFERENCE_REFUSALS,
  'work_template_version_unavailable',
  'work_template_reference_unavailable',
  'template_apply_failed',
] as const;

/** The project columns of a project creation function; the function checks them under lock. */
export function projectCreationColumns(input: z.infer<typeof createProjectInputSchema>): Json {
  return toJson({
    name: input.name.trim(),
    description: input.description?.trim() || null,
    client_id: input.clientId || null,
    site_id: input.siteId || null,
    contact_id: input.contactId || null,
    project_number: input.projectNumber?.trim() ?? '',
    planned_start_date: input.plannedStartDate || null,
    planned_end_date: input.plannedEndDate || null,
  });
}
