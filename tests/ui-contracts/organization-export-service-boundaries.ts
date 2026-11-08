// Isolated stand-in for `@/lib/org-export/actions` and the router of
// use-export-builder.ts: the start and every part build wait in the write
// gate until the spec answers them; the route refresh after each part is a
// no-op, so the rows keep the props the fixture rendered.
import type { ActionResult } from '@/lib/action-result';
import { holdWrite } from './held-write-boundary';

export const CONTRACT_PART_IDS = ['contract-part-data', 'contract-part-files'] as const;

export async function startOrganizationExport(): Promise<
  ActionResult<{ exportId: string; partIds: string[] }>
> {
  const refusal = await holdWrite('start-export', null);
  return refusal
    ? { success: false, error: refusal }
    : { success: true, exportId: 'contract-export', partIds: [...CONTRACT_PART_IDS] };
}

export async function buildOrganizationExportPart(partId: unknown): Promise<ActionResult> {
  const refusal = await holdWrite('build-part', partId);
  return refusal ? { success: false, error: refusal } : { success: true };
}

export async function downloadOrganizationExportPart(): Promise<ActionResult<{ url: string }>> {
  return { success: false, error: 'export_download_failed' };
}

export function useRouter(): { refresh: () => void } {
  return { refresh: () => undefined };
}
