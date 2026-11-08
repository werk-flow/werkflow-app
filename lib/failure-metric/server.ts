// Counts each failure logError logs as the Vercel custom metric `werkflow.failure`, tagged with
// its label and code only, so the production watcher sees handled failures that answer below
// 500 (docs/technical/recovery-and-incidents.md#monitoring). Outside a Vercel Function,
// metric() does nothing. A browser bundle resolves `#failure-metric` to ./browser.ts instead,
// because @vercel/functions reads `process` when it loads.

import { metric } from '@vercel/functions';

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

/** Records one failure; returns what went wrong when recording threw, so logError can say so. */
export function countFailure(label: string, code: string | undefined): { error: unknown } | null {
  try {
    metric('werkflow.failure', 1, { label: toMetricTag(label), code: toMetricTag(code) });
    return null;
  } catch (error) {
    return { error };
  }
}
