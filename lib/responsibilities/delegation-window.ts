import { formatBerlin } from '@/lib/utils';

// Where a delegation window stands on a business date, and the date from
// which the owner's „Heute beenden“ or „Entfernen“ revokes it. The list and
// the end action read one rule, so the offered button is the one the server runs.

type DelegationWindow = {
  validFrom: string;
  validUntil: string;
  revokedFrom: string | null;
};

/**
 * `planned` has not started, `active` runs today, `ended` ran and is over,
 * `removed` was revoked before its first day and never took effect.
 */
export type DelegationWindowState = 'planned' | 'active' | 'ended' | 'removed';

export function delegationWindowState(
  delegation: DelegationWindow,
  businessDate: string,
): DelegationWindowState {
  if (delegation.revokedFrom !== null && delegation.revokedFrom <= delegation.validFrom) return 'removed';
  if (delegation.revokedFrom !== null && delegation.revokedFrom <= businessDate) return 'ended';
  if (delegation.validUntil < businessDate) return 'ended';
  return delegation.validFrom > businessDate ? 'planned' : 'active';
}

/**
 * The revocation date that ends the window today, or removes a window that
 * has not started from its first day; null when it is already over or
 * removed, so a repeated click writes nothing.
 */
export function delegationRevocationDate(delegation: DelegationWindow, businessDate: string): string | null {
  const state = delegationWindowState(delegation, businessDate);
  if (state === 'planned') return delegation.validFrom;
  return state === 'active' ? businessDate : null;
}

/** „vom 2.11.2026 bis einschließlich 6.11.2026“, or „am 2.11.2026“ for one day. */
export function delegationPeriodText(validFrom: string, validUntil: string): string {
  const from = formatBerlin(validFrom, 'numericDate');
  if (validFrom === validUntil) return `am ${from}`;
  return `vom ${from} bis einschließlich ${formatBerlin(validUntil, 'numericDate')}`;
}
