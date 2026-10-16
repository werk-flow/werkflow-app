import { readFileSync } from 'node:fs';

// Size limits for product code (AGENTS.md "4. Code quality and
// maintainability"). A file or function that outgrows its limit is split.
// The modules and functions that predate these limits are listed in
// eslint-rules/size-cap-exceptions.json, each with its current size as its
// ceiling and a reason: a listed one may shrink, never grow, and
// lib/conventions/module-caps.test.ts fails on an entry that is stale (gone,
// back under the cap, or shorter than its ceiling) and on a directive that
// switches a size rule off.

/** Raw lines of any product module, tests under lib/ included. */
export const MODULE_LINE_LIMIT = 800;
/** Raw lines of a component or route file (`.tsx` under components/ and app/). */
export const COMPONENT_FILE_LINE_LIMIT = 500;
/** Lines of one function, blank and comment lines skipped. */
export const FUNCTION_LINE_LIMIT = 80;

/**
 * The shrink-only exceptions: `modules` maps a file to its ceiling in raw
 * lines, `functions` maps a file to its functions' keys
 * (eslint-rules/function-size.mjs) and their ceilings. `reasons` gives the
 * reason of every entry: the one under the longest path prefix that matches
 * the file, otherwise `default`.
 */
export const SIZE_CAP_EXCEPTIONS = JSON.parse(
  readFileSync(new URL('./size-cap-exceptions.json', import.meta.url), 'utf8'),
);
