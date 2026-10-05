import 'server-only';

import { z } from '@/lib/zod';

import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { requestCategoriesMatching, type RequestListQuery, type RequestPage } from './list-page';
import { toClientRequest } from './types';

const text = z.string().nullable();
const requestPageRowsSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  rows: z
    .array(
      z.object({
        id: uuidSchema,
        clientName: text,
        hasAssignee: z.boolean(),
        assigneeFirstName: text,
        assigneeLastName: text,
        assigneeEmail: text,
        jobNumber: text,
        jobTitle: text,
        projectNumber: text,
        projectName: text,
      }),
    )
    .max(LIST_PAGE_SIZE),
});

/**
 * One page of the request list. Internal reader: the page authorizes the
 * current manager and resolves the organization before it calls this. A
 * failed or malformed read throws; it never becomes an empty list.
 */
export async function readRequestPage(organizationId: string, query: RequestListQuery): Promise<RequestPage> {
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_request_page', {
    p_organization_id: organizationId,
    p_status: query.status,
    p_search: query.search,
    p_categories: requestCategoriesMatching(query.search),
    p_page: query.page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const parsed = requestPageRowsSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('request_page_read_failed');

  const { data: requestRows, error } = await readInBatches(
    parsed.data.rows.map((row) => row.id),
    (batch) =>
      admin.from('client_requests').select('*').eq('organization_id', organizationId).in('id', batch),
  );
  if (error) throw new Error('request_page_read_failed');
  const requestById = new Map(requestRows.map((row) => [row.id, toClientRequest(row)]));

  return {
    total: parsed.data.total,
    hasAnyRequest: parsed.data.hasAny,
    // A request deleted between the two reads leaves the page; the next
    // refresh corrects the count.
    entries: parsed.data.rows.flatMap((row) => {
      const request = requestById.get(row.id);
      if (!request) return [];
      const convertedLabel =
        (row.jobNumber ?? row.jobTitle)
          ? `Auftrag ${row.jobNumber ?? row.jobTitle}`
          : (row.projectNumber ?? row.projectName)
            ? `Projekt ${row.projectNumber ?? row.projectName}`
            : null;
      return [
        {
          request,
          clientName: row.clientName,
          assigneeName: row.hasAssignee
            ? formatProfileName({
                first_name: row.assigneeFirstName,
                last_name: row.assigneeLastName,
                email: row.assigneeEmail,
              })
            : null,
          convertedLabel,
        },
      ];
    }),
  };
}
