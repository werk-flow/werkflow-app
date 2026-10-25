/** The `code` of a Node system error (`ENOENT`, `ESRCH`, …), or undefined for any other value. */
export function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}
