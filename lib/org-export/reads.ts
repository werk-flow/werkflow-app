import 'server-only';

import { loggedRead } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readCompleteRows } from '@/lib/supabase/query-batches';
import type { OrganizationExportView, PartState } from './view';

// The Datenexport page's read: the latest exports of the organization with
// every part's state. The page renders it for an Admin only.

/** The page shows the latest exports; their archives are gone a week after each build. */
const SHOWN_EXPORTS = 5;
/** Parts are built, and built parts downloaded, for seven days (lib/org-export/build.ts). */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  const { data: exports, error } = await loggedRead(
    'readOrganizationExports: organization_exports read failed',
    admin
      .from('organization_exports')
      .select('id, requested_at, part_count, file_count, file_bytes')
      .eq('organization_id', organizationId)
      .order('requested_at', { ascending: false })
      .order('id')
      .limit(SHOWN_EXPORTS),
  );
  if (error) return { success: false, error: 'load_failed' };
  const parts = await Promise.all(exports.map((row) => readExportParts(admin, organizationId, row))).then(
    (rows) => rows,
    () => null,
  );
  if (parts === null) return { success: false, error: 'load_failed' };
  const now = Date.now();
  return {
    success: true,
    exports: exports.map((row, index) => ({
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
    })),
  };
}
