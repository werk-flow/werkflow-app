import type { Locator, Page } from '@playwright/test';

// Chained-precondition guards (enforcement ladder, Stage C 2026-08-29; reworded 2026-09-25).
//
// A test may depend on state an earlier test of the same file created
// (testing.md: "Chained tests"). Tests run in file order and continue after
// a failure, so a dependent test whose producer failed, or that runs without
// its producers in a partial grep or a diagnostic replay, must fail in seconds
// with the exact grep chain to run, never after minutes on a misleading
// locator timeout. These guards do that.

export interface ChainedPrecondition {
  /** The dependent test's ID as it appears in its title, e.g. 'A1-09'. */
  test: string;
  /** The persisted fact this test inherits, e.g. 'the customer created by A1-01'. */
  needs: string;
  /** Exact grep alternation that produces the state, e.g. 'A1-01|A1-05|A1-09'. */
  grep: string;
  suite: 'audit' | 'golden';
}

function preconditionError(input: ChainedPrecondition): Error {
  return new Error(
    `Chained precondition missing for ${input.test}: ${input.needs}. ` +
      `Earlier tests in this file create that state — run the chain in one world: ` +
      `bun run test:${input.suite}:focused --grep "${input.grep}" (focused diagnostic lane; acceptance evidence comes from bun run test:verify --group <owning group>). ` +
      `(Without the chain the test would otherwise fail after minutes on a misleading locator timeout.)`
  );
}

/** Throws the self-explaining grep-chain error unless the condition holds. */
export function requireChainedPrecondition(
  satisfied: boolean,
  input: ChainedPrecondition
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
  input: ChainedPrecondition
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
  input: ChainedPrecondition & { timeoutMs?: number }
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
