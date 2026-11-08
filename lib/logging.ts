// The one way product code writes a failure to the log (AGENTS.md virtue 3:
// never log personal data, codes or provider bodies). A Postgres, PostgREST,
// Auth or provider error carries a message, details and hints that can quote
// row values, email addresses or the request. Only the classification leaves
// this module: the error's name, its code and its HTTP status. ESLint rejects
// `console.*` in lib/, app/api, app/auth and proxy.ts outside this file.
//
// On the server, each logged failure also counts once as the Vercel custom metric
// `werkflow.failure`, tagged with its label and code, so the production watcher sees handled
// failures that answer below 500 (docs/technical/recovery-and-incidents.md#monitoring).

import { metric } from '@vercel/functions';

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

// An email address, a link, a run of six digits (phone, account, long id) or of twenty hex
// characters and dashes (a UUID, a token) withholds the whole tag value: replacing characters
// would still let the data through.
const PERSONAL_DATA_SHAPE = /@|:\/\/|\d{6}|[0-9a-f-]{20}/i;
// Vercel's tag rule: 1 to 63 bytes of A-Z a-z 0-9 - _ . /, anything else stored as `_`.
const UNSUPPORTED_TAG_CHARACTERS = /[^A-Za-z0-9_./-]+/g;
const MAX_TAG_LENGTH = 63;

function toMetricTag(value: string | undefined): string {
  if (value !== undefined && PERSONAL_DATA_SHAPE.test(value)) return 'withheld';
  const tag = (value ?? '')
    .replace(UNSUPPORTED_TAG_CHARACTERS, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_TAG_LENGTH);
  return tag === '' ? 'none' : tag;
}

/** Counts a failure in Vercel Observability; outside a Vercel Function the call does nothing. */
function countFailure(label: string, code: string | undefined): void {
  try {
    metric('werkflow.failure', 1, { label: toMetricTag(label), code: toMetricTag(code) });
  } catch (error) {
    // best-effort: the failure itself is already in the log; only its count is lost.
    // eslint-disable-next-line no-restricted-properties -- the reviewed sink: only the classification is written
    console.error('logError: failure metric not recorded', classifyFailure(error));
  }
}

/** Logs a failure under a fixed label with its classification only. */
export function logError(label: string, error?: unknown): void {
  const failure = classifyFailure(error);
  // eslint-disable-next-line no-restricted-properties -- the reviewed sink: only the classification is written
  console.error(label, failure);
  // Browser failures are not counted: a browser has no Vercel runtime to receive them.
  if (typeof window === 'undefined') countFailure(label, failure.code);
}
