// The outcome classes and codes of field sync v1 (decision record 0010,
// "Outcome classes"). The device branches on `outcome` and shows `code`
// through its own German copy. A code here is stable: changing or removing
// one is a `/v2/` change.

type FieldSyncOutcome = 'accepted' | 'replayed' | 'rejected' | 'conflict' | 'retry';

type FieldSyncCode =
  | 'accepted'
  | 'replayed'
  | 'forbidden'
  | 'organization_mismatch'
  | 'closed_period'
  | 'invalid'
  | 'outside_recording_window'
  | 'idempotency_conflict'
  | 'version_conflict'
  | 'office_changed'
  | 'recovery_required'
  | 'correction_required'
  | 'unavailable'
  | 'unauthenticated';

export type FieldSyncVerdict = { outcome: FieldSyncOutcome; code: FieldSyncCode };

export const UNAVAILABLE: FieldSyncVerdict = { outcome: 'retry', code: 'unavailable' };
export const INVALID: FieldSyncVerdict = { outcome: 'rejected', code: 'invalid' };
export const FORBIDDEN: FieldSyncVerdict = { outcome: 'rejected', code: 'forbidden' };
