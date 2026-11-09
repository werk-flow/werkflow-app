import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { ClientRequest, ConvertRequestResult } from '@/lib/requests/types';
import { z } from '@/lib/zod';

// The 'converted' history row of a conversion, as the conversion functions write it.
const convertedEventSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('job'),
    jobId: z.string(),
    jobNumber: z.string().nullable(),
    attemptKey: z.string().optional(),
  }),
  z.object({
    target: z.literal('project'),
    projectId: z.string(),
    projectNumber: z.string().nullable(),
    attemptKey: z.string().optional(),
  }),
]);

// A converted request answers a retry of its conversion: the work a
// conversion into `target` under `attemptKey` made, from the request's
// history, else already_converted. The conversion functions answer a retry
// that reaches them the same way, under the request's lock
// (app_private.lock_request_for_conversion).
export async function convertedWorkOf(
  admin: AdminClient,
  request: ClientRequest,
  target: 'job' | 'project',
  attemptKey: string | undefined,
): Promise<ConvertRequestResult> {
  if (!attemptKey) return { success: false, error: 'already_converted' };
  // A request converts once, so it has one 'converted' row at most.
  const { data, error } = await admin
    .from('client_request_events')
    .select('event_payload')
    .eq('organization_id', request.organizationId)
    .eq('request_id', request.id)
    .eq('event_type', 'converted');
  if (error) {
    logReadFailure('convertedWorkOf: conversion history read failed', error);
    return { success: false, error: 'load_failed' };
  }
  const converted = convertedEventSchema.safeParse(data[0]?.event_payload);
  if (!converted.success || converted.data.attemptKey !== attemptKey) {
    return { success: false, error: 'already_converted' };
  }
  const event = converted.data;
  if (target === 'job' && event.target === 'job' && event.jobId === request.convertedJobId) {
    return { success: true, target: 'job', jobId: event.jobId, jobNumber: event.jobNumber };
  }
  if (target === 'project' && event.target === 'project' && event.projectId === request.convertedProjectId) {
    return {
      success: true,
      target: 'project',
      projectId: event.projectId,
      projectNumber: event.projectNumber,
    };
  }
  return { success: false, error: 'already_converted' };
}
