import 'server-only';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { z } from '@/lib/zod';
import {
  WORK_TARGET_KINDS,
  type RequestWorkTarget,
  type RequestWorkTargetPage,
  type WorkRequestEntriesResult,
  type WorkTargetKind,
} from './types';

/** The open work the attach dialog shows at most; a search narrows the rest. */
const REQUEST_WORK_TARGET_LIMIT = 50;

const workTargetKindSchema = z.enum(WORK_TARGET_KINDS);
const workTargetRowsSchema = z.array(
  z.object({
    kind: workTargetKindSchema,
    id: z.string(),
    number: z.string().nullable(),
    title: z.string(),
    site_label: z.string().nullable(),
    at_request_site: z.boolean(),
  }),
);

/**
 * The first open jobs, projects and Servicefälle of the request's customer
 * that match the search, at the request's site first, and whether more
 * match. Managers only; a request outside the caller's organization is
 * request_not_found.
 */
export async function getRequestWorkTargets(input: {
  requestId: string;
  query: string;
}): Promise<RequestWorkTargetPage> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

    // One row past the limit tells whether more match.
    const { data, error } = await createSupabaseAdminClient().rpc('list_request_work_targets', {
      p_organization_id: auth.context.orgId,
      p_request_id: input.requestId,
      p_search: input.query,
      p_limit: REQUEST_WORK_TARGET_LIMIT + 1,
    });
    if (error) {
      if (error.message === 'request_not_found') return { success: false, error: 'request_not_found' };
      logReadFailure('getRequestWorkTargets: open work read failed', error);
      return { success: false, error: 'load_failed' };
    }
    const rows = workTargetRowsSchema.safeParse(data);
    if (!rows.success) {
      logError('getRequestWorkTargets: open work rows malformed', rows.error);
      return { success: false, error: 'load_failed' };
    }
    const targets: RequestWorkTarget[] = rows.data.slice(0, REQUEST_WORK_TARGET_LIMIT).map((row) => ({
      kind: row.kind,
      id: row.id,
      number: row.number,
      title: row.title,
      siteLabel: row.site_label,
      atRequestSite: row.at_request_site,
    }));
    return { success: true, targets, hasMore: rows.data.length > REQUEST_WORK_TARGET_LIMIT };
  } catch (error) {
    logError('Unexpected error in getRequestWorkTargets:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

const ENTRY_WORK_COLUMN: Readonly<Record<WorkTargetKind, 'job_id' | 'project_id' | 'service_case_id'>> = {
  job: 'job_id',
  project: 'project_id',
  service_case: 'service_case_id',
};

/**
 * The requests attached to one job, project or Servicefall, oldest first,
 * with who attached them. Managers only; work outside the caller's
 * organization has none.
 */
export async function getWorkRequestEntries(work: {
  kind: WorkTargetKind;
  id: string;
}): Promise<WorkRequestEntriesResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
    const { orgId } = auth.context;
    const admin = createSupabaseAdminClient();

    const { data: rows, error } = await readCompleteRows(
      (from, to) =>
        admin
          .from('work_request_entries')
          .select('id, request_id, summary, details, created_at, created_by, client_requests(request_number)')
          .eq('organization_id', orgId)
          .eq(ENTRY_WORK_COLUMN[work.kind], work.id)
          .order('created_at')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    );
    if (error) {
      logReadFailure('getWorkRequestEntries: entries read failed', error);
      return { success: false, error: 'load_failed' };
    }

    const actorIds = [...new Set(rows.flatMap((row) => (row.created_by ? [row.created_by] : [])))];
    const { data: actors, error: actorError } = await readInBatches(actorIds, (batch) =>
      admin.from('profiles').select('id, first_name, last_name, email').in('id', batch),
    );
    if (actorError) {
      logReadFailure('getWorkRequestEntries: actor read failed', actorError);
      return { success: false, error: 'load_failed' };
    }
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));

    return {
      success: true,
      entries: rows.map((row) => {
        const actor = row.created_by ? actorById.get(row.created_by) : undefined;
        return {
          id: row.id,
          requestId: row.request_id,
          requestNumber: row.client_requests?.request_number ?? null,
          summary: row.summary,
          details: row.details,
          createdAt: row.created_at,
          actorName: actor ? formatProfileName(actor) : null,
        };
      }),
    };
  } catch (error) {
    logError('Unexpected error in getWorkRequestEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
