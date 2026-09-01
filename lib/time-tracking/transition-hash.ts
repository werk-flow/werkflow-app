import { createHash } from 'node:crypto';

import type {
  TimeActivitySelection,
  TimeTransitionAction,
} from './types';

export type TimeTransitionHashInput = {
  organizationId: string;
  action: TimeTransitionAction;
  expectedSessionId: string | null;
  expectedVersion: number | null;
  selection: TimeActivitySelection | null;
  acknowledgeLong: boolean;
};

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

export function hashTimeTransitionRequest(
  input: TimeTransitionHashInput
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      organizationId: input.organizationId,
      action: input.action,
      expectedSessionId: input.expectedSessionId,
      expectedVersion: input.expectedVersion,
      selection: canonicalize(input.selection),
      acknowledgeLong: input.acknowledgeLong,
    }))
    .digest('hex');
}
