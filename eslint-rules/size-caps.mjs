// Size limits for product code (AGENTS.md "4. Code quality and
// maintainability"). A file or function that outgrows its limit is split;
// no module or function is exempt. lib/conventions/module-caps.test.ts
// refuses a directive that switches a size rule off.

/** Raw lines of any product module, tests under lib/ included. */
export const MODULE_LINE_LIMIT = 800;
/** Raw lines of a component or route file (`.tsx` under components/ and app/). */
export const COMPONENT_FILE_LINE_LIMIT = 500;
/** Lines of one function, blank and comment lines skipped. */
export const FUNCTION_LINE_LIMIT = 80;
