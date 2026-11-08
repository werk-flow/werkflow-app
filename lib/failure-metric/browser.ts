// The browser half of `#failure-metric` (package.json "imports"): a browser has no Vercel
// runtime, so a failure logged there is not counted (docs/technical/recovery-and-incidents.md#monitoring).

import type { countFailure } from './server';

/** Counts nothing in a browser; the type keeps both halves interchangeable. */
const countNothing: typeof countFailure = () => null;

export { countNothing as countFailure };
