import 'server-only';

import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { INVALID, UNAVAILABLE } from './outcomes';
import { TIME_TRANSITION_KIND, replayTimeTransition, type TimeTransitionVerdict } from './time-transition';

// A batch of field sync v1 operations in the envelope of decision record 0010.
// Operations run in the order the device sent them, each as a fresh request:
// the caller's active organization and role come from the current
// memberships, and object permission, lifecycle and closed periods are
// established now, never taken from the device. An envelope's organization is
// a hint: one that differs from the caller's is refused, never switched to.

/** The most operations one request carries; a device sends a longer queue in several requests. */
const FIELD_SYNC_BATCH_LIMIT = 50;

const isoInstantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());

const envelopeSchema = z.strictObject({
  operationId: uuidSchema,
  kind: z.string().max(100),
  capturedAt: isoInstantSchema,
  sentAt: isoInstantSchema,
  organizationId: uuidSchema,
  payload: z.unknown(),
});

export const fieldSyncBatchSchema = z.strictObject({
  operations: z.array(z.unknown()).min(1).max(FIELD_SYNC_BATCH_LIMIT),
});

export type FieldSyncOperationResult = TimeTransitionVerdict & { operationId: string | null };

function operationIdOf(value: unknown): string | null {
  const parsed = z.object({ operationId: uuidSchema }).safeParse(value);
  return parsed.success ? parsed.data.operationId : null;
}

async function runOperation(context: ActionContext, raw: unknown): Promise<TimeTransitionVerdict> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const envelope = parsed.data;
  // v1 names one kind so far; any other is refused, never guessed.
  if (envelope.kind !== TIME_TRANSITION_KIND) return INVALID;
  if (envelope.organizationId !== context.orgId)
    return { outcome: 'rejected', code: 'organization_mismatch' };
  return replayTimeTransition(
    { userId: context.userId, organizationId: context.orgId },
    {
      operationId: envelope.operationId,
      payload: envelope.payload,
      capture: { capturedAt: envelope.capturedAt, sentAt: envelope.sentAt },
    },
  );
}

/**
 * The result of each operation, in the sent order. After the first `retry`
 * the rest are not attempted and answer `retry` too: a later operation of the
 * same clock depends on the earlier one, so it waits for it.
 */
export async function runFieldSyncOperations(
  context: ActionContext,
  operations: readonly unknown[],
): Promise<FieldSyncOperationResult[]> {
  const results: FieldSyncOperationResult[] = [];
  let halted = false;
  for (const raw of operations) {
    let verdict: TimeTransitionVerdict = UNAVAILABLE;
    if (!halted) {
      try {
        verdict = await runOperation(context, raw);
      } catch (error) {
        // The device keeps the operation pending and sends it again.
        logError('runFieldSyncOperations: operation failed', error);
        verdict = UNAVAILABLE;
      }
    }
    halted ||= verdict.outcome === 'retry';
    results.push({ operationId: operationIdOf(raw), ...verdict });
  }
  return results;
}
