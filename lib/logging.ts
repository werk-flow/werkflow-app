// The one way product code writes a failure to the log (AGENTS.md virtue 3:
// never log personal data, codes or provider bodies). A Postgres, PostgREST,
// Auth or provider error carries a message, details and hints that can quote
// row values, email addresses or the request. Only the classification leaves
// this module: the error's name, its code and its HTTP status. ESLint rejects
// `console.*` in lib/, app/api, app/auth and proxy.ts outside this file.

/** The reviewed fields of a logged failure. */
type LoggedFailure = { name?: string; code?: string; status?: number };

// A bare string is logged only when it looks like a stable code, never as free text.
const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

function readStringField(value: object, key: string): string | undefined {
  const field: unknown = Reflect.get(value, key);
  if (typeof field === 'string' && CODE_PATTERN.test(field)) return field;
  if (typeof field === 'number' && Number.isFinite(field)) return String(field);
  return undefined;
}

/** Reduces any thrown or returned failure to its name, code and status. */
function classifyFailure(error: unknown): LoggedFailure {
  if (typeof error === 'string') return CODE_PATTERN.test(error) ? { code: error } : { name: 'string' };
  if (typeof error !== 'object' || error === null) {
    return error === undefined ? {} : { name: typeof error };
  }
  const name = readStringField(error, 'name');
  const code = readStringField(error, 'code');
  const statusValue: unknown = Reflect.get(error, 'status');
  const status = typeof statusValue === 'number' && Number.isFinite(statusValue) ? statusValue : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

/** Logs a failure under a fixed label with its classification only. */
export function logError(label: string, error?: unknown): void {
  // eslint-disable-next-line no-restricted-properties -- the reviewed sink: only the classification is written
  console.error(label, classifyFailure(error));
}
