import { config } from 'zod';

// The Zod members the product uses, as named imports. lib/zod.ts turns this
// module into the namespace `z`. The bundler can drop whatever is not named
// here, while a re-export of Zod's own `z` namespace keeps all of it: 63 locales
// and the JSON Schema conversion rode in the shell chunk of every cold start.
// A schema that needs another member adds it to this list. English stays the
// default locale, because Zod registers it when the first schema is built.
//
// Zod 4 probes `Function("")` the first time an object schema is built, to
// decide whether it may compile a fast parser. The content security policy has
// no 'unsafe-eval', so in the browser that probe fails and reports a violation
// to /api/csp-report on every page load. `jitless` skips the probe, and it
// takes effect only before the first schema is built: this module's body runs
// before any module that imports `z`.
config({ jitless: true });

export {
  array,
  boolean,
  coerce,
  discriminatedUnion,
  email,
  enum,
  guid,
  iso,
  json,
  lazy,
  literal,
  null,
  number,
  object,
  partialRecord,
  preprocess,
  record,
  strictObject,
  string,
  union,
  unknown,
  uuid,
  ZodIssueCode,
} from 'zod';
export type {
  infer,
  input,
  output,
  RefinementCtx,
  ZodNullable,
  ZodOptional,
  ZodPreprocess,
  ZodString,
  ZodType,
  ZodTypeAny,
} from 'zod';
