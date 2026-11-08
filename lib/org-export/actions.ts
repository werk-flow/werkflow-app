'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { buildExportPart, signExportDownload, startExport } from './build';
import type { OrganizationExportFailureCode } from './messages';

// The organization export's actions (werk-flow/werkflow-planning#287). Only an
// Admin of the active organization starts an export, builds its parts and
// downloads them; Büro and employees are refused before any read. A part id
// of another organization answers like an unknown one.

type ExportResult<Data = object> = ActionResult<Data, OrganizationExportFailureCode>;

const KNOWN_REFUSALS = new Set<string>([
  'not_authorized',
  'export_plan_stale',
  'export_plan_invalid',
  'export_plan_repeats_file',
  'export_plan_repeats_name',
  'export_part_not_found',
  'export_part_ready',
  'export_part_not_ready',
  'export_part_expired',
]);

function isKnownRefusal(code: string): code is OrganizationExportFailureCode {
  return KNOWN_REFUSALS.has(code);
}

/** A refusal the database raised as its code, or the action's fallback, logged without detail. */
function failureOf(
  error: unknown,
  fallback: OrganizationExportFailureCode,
  label: string,
): ActionFailure<OrganizationExportFailureCode> {
  if (error instanceof Error && isKnownRefusal(error.message))
    return { success: false, error: error.message };
  logError(label, error);
  return { success: false, error: fallback };
}

async function resolveAdmin(): Promise<
  ActionResult<{ context: ActionContext }, OrganizationExportFailureCode>
> {
  const resolved = await resolveActionContext();
  if (!resolved.success) return resolved;
  if (resolved.context.role !== 'admin') return { success: false, error: 'not_authorized' };
  return resolved;
}

/** Plans the export of every record and original file of the active organization. */
export async function startOrganizationExport(): Promise<
  ExportResult<{ exportId: string; partIds: string[] }>
> {
  const auth = await resolveAdmin();
  if (!auth.success) return auth;
  try {
    const started = await startExport(createSupabaseAdminClient(), {
      organizationId: auth.context.orgId,
      userId: auth.context.userId,
    });
    return { success: true, ...started };
  } catch (error) {
    return failureOf(error, 'export_start_failed', 'startOrganizationExport failed');
  }
}

/** Builds one part of an export within this request; a failed part builds again alone. */
export async function buildOrganizationExportPart(rawPartId: unknown): Promise<ExportResult> {
  const partId = uuidSchema.safeParse(rawPartId);
  if (!partId.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveAdmin();
  if (!auth.success) return auth;
  try {
    await buildExportPart(
      createSupabaseAdminClient(),
      { organizationId: auth.context.orgId, userId: auth.context.userId },
      partId.data,
    );
    return { success: true };
  } catch (error) {
    return failureOf(error, 'export_part_failed', 'buildOrganizationExportPart failed');
  }
}

/** A short-lived download URL of a ready part; the download is recorded first. */
export async function downloadOrganizationExportPart(
  rawPartId: unknown,
): Promise<ExportResult<{ url: string }>> {
  const partId = uuidSchema.safeParse(rawPartId);
  if (!partId.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveAdmin();
  if (!auth.success) return auth;
  try {
    const url = await signExportDownload(
      createSupabaseAdminClient(),
      { organizationId: auth.context.orgId, userId: auth.context.userId },
      partId.data,
    );
    return { success: true, url };
  } catch (error) {
    return failureOf(error, 'export_download_failed', 'downloadOrganizationExportPart failed');
  }
}
