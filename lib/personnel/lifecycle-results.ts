import 'server-only';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';

// The result shape, request hash, failure codes and revalidated paths shared
// by the personnel lifecycle Server Actions (lifecycle-actions.ts,
// onboarding-actions.ts).

// A lifecycle success nests its payload under `data`; a rejected transition may return the blocking inventory there.
export type LifecycleResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | (ActionFailure & { data?: T });

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function lifecycleFailureCode(error: { code?: string; message?: string } | null): string {
  const message = error?.message ?? 'mutation_failed';
  const known = [
    'forbidden',
    'stale_version',
    'operation_id_conflict',
    'last_admin_protected',
    'organization_owner_protected',
    'last_responsibility_holder',
    'membership_required',
    'future_effective_at_required',
    'immediate_effective_at_required',
    'future_effective_date_required',
    'no_scheduled_transition',
    'access_requirements_incomplete',
    'document_not_released',
    'document_version_not_found',
    'personnel_document_not_found',
    'requirement_not_found',
    'requirement_not_open',
    'employee_record_not_found',
    'template_version_not_found',
    'template_not_found',
    'plan_not_found',
    'owner_not_found',
    'release_not_active',
    'active_access_required',
    'invalid_transition',
    'invalid_template_item',
    'invalid_template',
    'invalid_requirement',
    'invalid_document_type',
    'invalid_document',
    'invalid_reference',
    'invalid_acknowledgement',
    'invalid_plan',
    'reason_required',
    'statement_required',
  ].find((code) => message.includes(code));
  if (known) return known;
  logError('Unexpected personnel lifecycle database error', error);
  return 'mutation_failed';
}

export function revalidatePersonnel(): void {
  revalidatePath('/mitarbeiter');
  revalidatePath('/aufgaben');
  revalidatePath('/onboarding/meine-aufgaben');
}
