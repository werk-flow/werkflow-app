// What the Datenexport page shows of an export and its parts.

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

/** A part the Admin can build: not built yet, or failed. */
export function isBuildable(part: OrganizationExportPartView): boolean {
  return part.state === 'pending' || part.state === 'failed';
}
