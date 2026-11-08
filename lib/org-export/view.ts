// What the Datenexport page shows of an export and its parts.

import { isRetryablePartFailure } from './messages';

/** `expired`: the archive is deleted, or the export's parts can no longer be built. */
export type PartState = 'pending' | 'ready' | 'failed' | 'expired';

export type OrganizationExportPartView = {
  id: string;
  partNumber: number;
  kind: 'data' | 'files';
  state: PartState;
  fileCount: number;
  fileBytes: number;
  expiresAt: string | null;
  failureReason: string | null;
};

export type OrganizationExportView = {
  id: string;
  requestedAt: string;
  fileCount: number;
  fileBytes: number;
  parts: OrganizationExportPartView[];
};

/**
 * A part the Admin can build: not built yet, or failed for a reason a new
 * build can fix. `refusal` is this page's latest refusal of the part's build,
 * which counts before the stored reason the page read.
 */
export function isBuildable(part: OrganizationExportPartView, refusal: string | undefined): boolean {
  if (part.state !== 'pending' && part.state !== 'failed') return false;
  const reason = refusal ?? part.failureReason;
  return reason === null || isRetryablePartFailure(reason);
}
