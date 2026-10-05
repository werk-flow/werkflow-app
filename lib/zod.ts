import { z } from 'zod';

// The one Zod entry point of product code (lib/conventions/zod-entry.test.ts).
// Zod 4 probes `Function("")` the first time an object schema is built, to
// decide whether it may compile a fast parser. The content security policy has
// no 'unsafe-eval', so in the browser that probe fails and reports a violation
// to /api/csp-report on every page load. `jitless` skips the probe, and it
// takes effect only before the first schema is built: every schema module
// imports `z` from here, so this line runs first.
z.config({ jitless: true });

export { z };
