import type { RecordCustomerConditionInput } from '@/lib/price-catalog/action-schemas';
import type { ActionResult } from '@/lib/action-result';
import type { ConditionChanged } from '@/lib/price-catalog/customer-conditions';
import { holdWrite } from './held-write-boundary';

/** The version another session recorded meanwhile, which a `condition_changed` refusal names. */
export const CONTRACT_NEWER_CONDITION_VERSION = 3;

// The section's save waits at the write gate. The spec accepts it, or refuses
// it with a code; `condition_changed` names the newer version, as the action
// reads it on the server.
export async function recordCustomerCondition(
  input: RecordCustomerConditionInput,
): Promise<ActionResult<{ version: number; clientId: string; updatedAt: string }> | ConditionChanged> {
  const refusal = await holdWrite('recordCustomerCondition', input);
  if (refusal === 'condition_changed') {
    return { success: false, error: refusal, currentVersion: CONTRACT_NEWER_CONDITION_VERSION };
  }
  if (refusal !== null) return { success: false, error: refusal };
  return {
    success: true,
    version: CONTRACT_NEWER_CONDITION_VERSION + 1,
    clientId: input.clientId,
    updatedAt: '2026-11-27T08:00:00.000000+00:00',
  };
}
