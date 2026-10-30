import 'server-only';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Tables } from '@/lib/supabase/database.types';
import { hashTimeTransitionRequest } from './transition-hash';

// The canonical half of clockOutBeforeSignOut (clock-state-actions.ts): ends
// one open session of the signed-in user, recovering it first when the
// database asks for that. The caller resolves the user and reads the sessions.

type OpenSession = Pick<Tables<'time_sessions'>, 'id' | 'organization_id' | 'version' | 'status'>;

function getTransitionOutcome(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('outcome' in value)) return null;
  return typeof value.outcome === 'string' ? value.outcome : null;
}

function getTransitionVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('version' in value)) return null;
  return typeof value.version === 'number' ? value.version : null;
}

/** Whether the session ended; a failure is logged and leaves the session open. */
export async function endSessionBeforeSignOut(
  admin: AdminClient,
  userId: string,
  session: OpenSession,
): Promise<boolean> {
  const operationId = crypto.randomUUID();
  const action = session.status === 'recovery_required' ? 'recover_end' : 'end';
  const requestHash = hashTimeTransitionRequest({
    organizationId: session.organization_id,
    action,
    expectedSessionId: session.id,
    expectedVersion: session.version,
    selection: null,
    acknowledgeLong: action === 'recover_end',
  });
  const transitionArgs = rpcArgs('transition_time_activity', {
    p_organization_id: session.organization_id,
    p_actor_id: userId,
    p_operation_id: operationId,
    p_request_hash: requestHash,
    p_action: action,
    p_expected_session_id: session.id,
    p_expected_version: session.version,
    p_acknowledge_long: action === 'recover_end',
  });
  let { data: transitionResult, error } = await admin.rpc('transition_time_activity', transitionArgs);
  if (error) {
    logError('Error ending canonical session before sign-out:', error);
    return false;
  }
  if (getTransitionOutcome(transitionResult) === 'recovery_required') {
    const recoveryOperationId = crypto.randomUUID();
    const recoveryExpectedVersion = getTransitionVersion(transitionResult) ?? session.version;
    const recoveryRequestHash = hashTimeTransitionRequest({
      organizationId: session.organization_id,
      action: 'recover_end',
      expectedSessionId: session.id,
      expectedVersion: recoveryExpectedVersion,
      selection: null,
      acknowledgeLong: true,
    });
    const recoveryResult = await admin.rpc('transition_time_activity', {
      ...transitionArgs,
      p_operation_id: recoveryOperationId,
      p_request_hash: recoveryRequestHash,
      p_action: 'recover_end',
      p_expected_version: recoveryExpectedVersion,
      p_acknowledge_long: true,
    });
    transitionResult = recoveryResult.data;
    error = recoveryResult.error;
  }
  if (error || getTransitionOutcome(transitionResult) !== 'ended') {
    logError(
      'Canonical session remained open before sign-out:',
      error ?? getTransitionOutcome(transitionResult),
    );
    return false;
  }
  return true;
}
