import 'server-only';

import { loggedRead } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { OrganizationExportView, PartState } from './view';

// The Datenexport page's read: the latest exports of the organization and
// every older one with a part still to build or download, each with every
// part's state. The page renders it for an Admin only.

/** The page shows the latest exports, and an older one only while a part is available. */
const SHOWN_EXPORTS = 5;
/** Parts are built, and built parts downloaded, for seven days (lib/org-export/build.ts). */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A part builds within seven days of the start and stays downloadable seven days after its build. */
const AVAILABLE_MS = 2 * WINDOW_MS;

type PartRow = { state: string; expires_at: string | null };

function partState(part: PartRow, requestedAt: string, now: number): PartState {
  if (part.state === 'ready')
    return part.expires_at && Date.parse(part.expires_at) > now ? 'ready' : 'expired';
  if (Date.parse(requestedAt) <= now - WINDOW_MS) return 'expired';
  return part.state === 'failed' ? 'failed' : 'pending';
}

type ExportPartRow = Pick<
  Tables<'organization_export_parts'>,
  'id' | 'part_number' | 'kind' | 'state' | 'file_count' | 'file_bytes' | 'expires_at' | 'failure_reason'
>;

/**
 * Every part of an export, page by page in part order. Fewer or more rows
 * than the export's part count fail the read, so no part goes missing silently.
 */
export async function readExportParts(
  admin: AdminClient,
  organizationId: string,
  exportRow: { id: string; part_count: number },
): Promise<ExportPartRow[]> {
  const parts = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_export_parts')
        .select('id, part_number, kind, state, file_count, file_bytes, expires_at, failure_reason')
        .eq('organization_id', organizationId)
        .eq('export_id', exportRow.id)
        .order('part_number')
        .range(from, to),
    exportRow.part_count,
  );
  if (parts.error || parts.data.length !== exportRow.part_count) throw new Error('load_failed');
  return parts.data;
}

export async function readOrganizationExports(
  organizationId: string,
): Promise<ActionResult<{ exports: OrganizationExportView[] }, 'load_failed'>> {
  const admin = createSupabaseAdminClient();
  const columns = 'id, requested_at, part_count, file_count, file_bytes';
  const now = Date.now();
  const availableSince = new Date(now - AVAILABLE_MS).toISOString();
  const [latest, recent] = await Promise.all([
    loggedRead(
      'readOrganizationExports: organization_exports read failed',
      admin
        .from('organization_exports')
        .select(columns)
        .eq('organization_id', organizationId)
        .order('requested_at', { ascending: false })
        .order('id')
        .limit(SHOWN_EXPORTS),
    ),
    loggedRead(
      'readOrganizationExports: recent organization_exports read failed',
      readCompleteRows(
        (from, to) =>
          admin
            .from('organization_exports')
            .select(columns)
            .eq('organization_id', organizationId)
            .gte('requested_at', availableSince)
            .order('requested_at', { ascending: false })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (latest.error || recent.error) return { success: false, error: 'load_failed' };
  const latestIds = new Set(latest.data.map((row) => row.id));
  const exports = [...new Map([...latest.data, ...recent.data].map((row) => [row.id, row])).values()].sort(
    (left, right) =>
      Date.parse(right.requested_at) - Date.parse(left.requested_at) || left.id.localeCompare(right.id),
  );
  const parts = await Promise.all(exports.map((row) => readExportParts(admin, organizationId, row))).then(
    (rows) => rows,
    () => null,
  );
  if (parts === null) return { success: false, error: 'load_failed' };
  const views = exports.map(
    (row, index): OrganizationExportView => ({
      id: row.id,
      requestedAt: row.requested_at,
      fileCount: row.file_count,
      fileBytes: row.file_bytes,
      parts: (parts[index] ?? []).map((part) => ({
        id: part.id,
        partNumber: part.part_number,
        kind: part.kind === 'data' ? 'data' : 'files',
        state: partState(part, row.requested_at, now),
        fileCount: part.file_count,
        fileBytes: part.file_bytes,
        expiresAt: part.expires_at,
        failureReason: part.failure_reason,
      })),
    }),
  );
  return {
    success: true,
    exports: views.filter(
      (view) => latestIds.has(view.id) || view.parts.some((part) => part.state !== 'expired'),
    ),
  };
}
