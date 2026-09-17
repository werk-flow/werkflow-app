import { z } from 'zod';

import type { BackgroundReadInput, BackgroundReadKind, BackgroundReadResult } from './background-reads';

export type BackgroundReadFailure = { success: false; error: 'background_read_failed' };

const envelopeSchema = z.object({ success: z.boolean() }).passthrough();

/**
 * Runs a registered background reader over `GET /api/background-read`, so the
 * fetch starts immediately instead of waiting in the browser's serialized
 * Server Action queue. The reader's own result type comes back unchanged; the
 * client checks the envelope and the HTTP status, and the route has already
 * verified the caller and the organization. Forward the live view's abort
 * signal so an obsolete read is cancelled instead of committing late.
 */
export async function readInBackground<Kind extends BackgroundReadKind>(
  kind: Kind,
  input: BackgroundReadInput<Kind>,
  signal?: AbortSignal
): Promise<BackgroundReadResult<Kind> | BackgroundReadFailure> {
  try {
    const query = new URLSearchParams({ kind, input: JSON.stringify(input) });
    const response = await fetch(`/api/background-read?${query}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: signal ?? null,
    });
    const parsed = envelopeSchema.safeParse(await response.json());
    if (!parsed.success || (!response.ok && parsed.data.success)) {
      return { success: false, error: 'background_read_failed' };
    }
    return parsed.data as BackgroundReadResult<Kind>;
  } catch {
    return { success: false, error: 'background_read_failed' };
  }
}
