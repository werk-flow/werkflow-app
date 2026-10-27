import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { readTimeAccountManagement } from './access';
import { isTimeAccountFailureCode, type TimeAccountAction, type TimeAccountFailureCode } from './messages';

// Steps the time-account form actions share. A 'use server' module exports only actions, so they live here.

/** The manager gate of the period actions: a failed responsibility read is its own code. */
export async function refuseNonManager(
  context: Parameters<typeof readTimeAccountManagement>[0],
): Promise<ActionFailure<'responsibility_load_failed' | 'forbidden'> | null> {
  const management = await readTimeAccountManagement(context);
  if (!management.success) return management;
  return management.canManage ? null : { success: false, error: 'forbidden' };
}

/**
 * The stable code of a refused period RPC or of a thrown period step: a known
 * code passes through (also with a detail suffix such as
 * `incomplete_period_population: …`), anything else is logged and becomes
 * the action's catch-all code.
 */
export function failureCode<Action extends TimeAccountAction>(
  action: Action,
  fallback: TimeAccountFailureCode<Action>,
  label: string,
  error: unknown,
): TimeAccountFailureCode<Action> {
  const message =
    error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
      ? String(error.message)
      : '';
  const code = message.split(':')[0]?.trim() ?? '';
  if (isTimeAccountFailureCode(action, code)) return code;
  logError(label, error);
  return fallback;
}

/** A whole number written without a sign other than a leading minus; null otherwise. */
export function parseStrictInteger(value: FormDataEntryValue | null): number | null {
  const text = typeof value === 'string' ? value : '';
  if (!/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
