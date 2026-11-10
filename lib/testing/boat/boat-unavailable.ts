import { type BoatClient } from './boat-api';
import { shellQuote } from './boat-machine';
import { type TransferContext, type TransferPolicy, transfer, transportFailure } from './boat-transfer';

// When Boat cannot run a plan, the workstation runs only its cheap groups and holds the heavy ones
// back (docs/technical/boat-verification.md, "Fallback"). A start that hit a passing network failure
// gets fresh attempts first, so one refused connection does not cost the run its Boat machine.

/** Boat was wanted but cannot run the plan; the heavy groups then stay blocked here (heldBackHere). */
export type BoatUnavailable = { unavailable: string };

/**
 * The machine's creation, before any machine exists: a connection that fails on the way to Boat
 * gets two fresh attempts over 30 s with the same idempotency key, so Boat starts one machine at
 * most. Boat's own refusal (a 401, 403, 429 or 503 with its code) gets none. Each request ends after
 * 60 s by itself (boat-api.ts), well inside the attempt's deadline.
 */
const MACHINE_START: TransferPolicy = {
  waits: [10_000, 20_000],
  attemptMs: 90_000,
  retryable: transportFailure,
};

/**
 * The client whose machine creation retries a failed connection (MACHINE_START). Every attempt
 * sends the same idempotency key, so a request that reached Boat before its connection failed
 * starts no second machine. `wait` is a test's stand-in.
 */
export function retryingStart(client: BoatClient, context: TransferContext): BoatClient {
  return {
    ...client,
    create: (request, idempotencyKey) =>
      transfer('Starting a Boat machine', MACHINE_START, context, () =>
        client.create(request, idempotencyKey),
      ),
  };
}

/** What a held-back group usually costs this workstation (lib/testing/runner/heavy-slot.ts). */
function localCost(id: string): string {
  if (id === 'static:lint') return 'type-aware lint, 170 to 370 s at up to 4.1 GiB on an idle PC';
  return 'a production build at up to 2.9 GiB, then the stack and a browser';
}

/**
 * The notice a local run prints when Boat is unavailable: why, which heavy groups it leaves blocked
 * with their usual cost, and how to run them here deliberately with `args`.
 */
export function unavailableNotice(
  reason: string,
  heldBack: readonly string[],
  args: readonly string[],
): string[] {
  if (!heldBack.length) return [`Boat is unavailable: ${reason} The plan runs only cheap groups, here.`];
  const rule = '='.repeat(72);
  return [
    rule,
    `BOAT IS UNAVAILABLE: ${reason}`,
    `${heldBack.length} heavy groups do NOT run here and are recorded as blocked:`,
    ...heldBack.map((id) => `  ${id}: ${localCost(id)}`),
    'Only the cheap groups run. This run cannot pass: it exits 1 and its report reads failed.',
    'Run again later to use Boat, or run the heavy groups here deliberately:',
    `  WERKFLOW_VERIFY_LOCAL=1 bun run test:verify${args.length ? ` ${args.map(shellQuote).join(' ')}` : ''}`,
    rule,
  ];
}
