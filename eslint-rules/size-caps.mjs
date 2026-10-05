// Size limits for product code (AGENTS.md "4. Code quality and
// maintainability"). They have no exception: a file or function that outgrows
// its limit is split. lib/conventions/module-caps.test.ts fails on a directive
// that switches a size rule off.

/** Raw lines of any product module. */
export const MODULE_LINE_LIMIT = 2000;
/** Raw lines of a component or route file (`.tsx` under components/ and app/). */
export const COMPONENT_FILE_LINE_LIMIT = 500;
/** Lines of one function, blank and comment lines skipped. */
export const FUNCTION_LINE_LIMIT = 200;
