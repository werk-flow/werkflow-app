import type { Locator, Page } from '@playwright/test';

// Serial-precondition guards (enforcement ladder, Stage C 2026-08-29).
//
// Mid-suite tests in a serial file legitimately depend on state their
// predecessors created (testing.md: "Mid-suite specs are not dual-mode").
// Running such a test without its producers — a partial iteration grep or a
// diagnostic replay in a fresh process — used to fail after minutes on a
// misleading locator timeout. These guards make the dependency explicit and
// fail in seconds with the exact grep chain to run instead.

export interface SerialPrecondition {
  /** The dependent test's ID as it appears in its title, e.g. 'A1-09'. */
  test: string;
  /** The persisted fact this test inherits, e.g. 'the customer created by A1-01'. */
  needs: string;
  /** Exact grep alternation that produces the state, e.g. 'A1-01|A1-05|A1-09'. */
  grep: string;
  suite: 'audit' | 'golden';
}

function preconditionError(input: SerialPrecondition): Error {
  return new Error(
    `Serial precondition missing for ${input.test}: ${input.needs}. ` +
      `Earlier tests in this serial file create that state — run the chain in one world: ` +
      `bun run test:${input.suite}:focused --grep "${input.grep}". ` +
      `(A partial grep of a serial file would otherwise fail after minutes on a misleading locator timeout.)`
  );
}

/** Throws the self-explaining grep-chain error unless the condition holds. */
export function requireSerialPrecondition(
  satisfied: boolean,
  input: SerialPrecondition
): void {
  if (!satisfied) throw preconditionError(input);
}

/**
 * Returns the chained value when a producer test recorded it; throws the
 * grep-chain error when the value is still empty (the file ran without its
 * producers). Prefer run-scoped derivable identities over chained values —
 * use this only where the app assigns the value (job numbers, invite codes).
 */
export function requireChainedValue<T>(
  value: T | null | undefined | '',
  input: SerialPrecondition
): T {
  if (value === null || value === undefined || value === '') {
    throw preconditionError(input);
  }
  return value;
}

/**
 * UI-side variant for facts only the page can prove cheaply: asserts the
 * locator resolves within a short bounded window and converts the timeout
 * into the self-explaining grep-chain error.
 */
export async function requireVisiblePrecondition(
  locator: Locator,
  input: SerialPrecondition & { timeoutMs?: number }
): Promise<void> {
  const timeout = input.timeoutMs ?? 10_000;
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    throw preconditionError(input);
  }
}

/**
 * Navigation guard for read-only routes: a Realtime router refresh can abort
 * a same-moment navigation with net::ERR_ABORTED. Retries the goto once —
 * read-only, so the retry cannot duplicate a write. (Shared home for the
 * pattern the Stage A campaign added per-file.)
 */
export async function gotoReadOnlyRoute(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('net::ERR_ABORTED')) {
      throw error;
    }
    await page.goto(path);
  }
}
