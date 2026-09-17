'use server';

import { authenticateAndAuthorize } from './auth';
import { loadJobEntityOptions } from './option-server';
import { jobOptionRequestSchema, type JobOptionRequest, type JobOptionResult } from './option-types';

export async function searchJobEntityOptions(input: JobOptionRequest): Promise<JobOptionResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  const parsed = jobOptionRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  if (parsed.data.organizationId !== auth.context.orgId) return { success: false, error: 'organization_changed' };
  return loadJobEntityOptions(auth.context, parsed.data);
}
