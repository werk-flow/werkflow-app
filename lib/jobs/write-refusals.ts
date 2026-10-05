import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';

/** The refusals of the customer reference check inside the work edit functions. */
export const CUSTOMER_REFERENCE_REFUSALS = [
  'client_not_found',
  'site_requires_client',
  'site_not_found',
  'site_client_mismatch',
  'contact_requires_client',
  'contact_not_found',
  'contact_client_mismatch',
] as const;

/**
 * The failure of a work write function: a refusal the function names is the
 * action's own code, anything else is logged and becomes the fallback.
 */
export function workWriteFailure(
  label: string,
  error: { message: string },
  refusals: readonly string[],
  fallback: string,
): ActionFailure {
  if (refusals.includes(error.message)) return { success: false, error: error.message };
  logError(label, error);
  return { success: false, error: fallback };
}
