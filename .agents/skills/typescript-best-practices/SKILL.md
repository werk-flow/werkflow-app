---
name: typescript-best-practices
description: TypeScript best practices. Use when designing types, validation boundaries, or non-trivial logic in any .ts or .tsx file.
---

# TypeScript best practices

Adapted for WerkFlow from cursor/plugins pstack (MIT).

## Boundaries

- External data enters through Server Actions, Route Handlers and Supabase responses. It is `unknown` there. Parse it once into a named domain type, then trust the type inside. [Security](../../../docs/technical/security.md) owns what a Server Action parses.
- Derive database shapes from `lib/supabase/database.types.ts`. Reach for `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited` and `typeof` before you declare a new type.
- `Record<string, unknown>` stops at the parse.

## Make illegal states unrepresentable

- Model variants as a discriminated union on `kind`, not a bag of optional fields:

  ```ts
  type DiffState =
    | { kind: 'loading' }
    | { kind: 'ready'; diff: GitDiff }
    | { kind: 'error'; error: string };
  ```

- Build the shape so the bad value cannot exist: `[T, ...T[]]` for non-empty, `[T, T][]` for pairs, `{ start, durationMs }` for a range.
- Keep `T[]` while every operation stays total. Strengthen to `NonEmpty<T>` only where the loose type forces `!`, a cast or a "never happens" throw.
- Brand a primitive that could be mixed up (`string & { readonly __brand: 'AgentId' }`), and validate it once where it is created.
- Pass an object, not positional arguments, when two arguments could swap. Skip it on hot paths.

## Narrow, never cast

- Narrow in this order: discriminant, `in`, `typeof` or `instanceof`, a type guard, and `as` only after full validation.
- A type guard (`isX`, `hasX`) must check what it claims. A lying guard hides the bug behind a safe-sounding name.
- Use `satisfies` instead of `as` to check a literal without widening it.
- End every switch over a union with an exhaustiveness check:

  ```ts
  default: {
    const _exhaustive: never = shape;
    return _exhaustive;
  }
  ```

- To remove an existing `as`, find why inference fails: a missing discriminant, a source type that is too wide, or an unparsed boundary.

## Strict flags

`tsconfig.json` sets `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.

- Never satisfy them with `!`, `as`, `@ts-expect-error` or `@ts-ignore`.
- An optional property that carries `undefined` on purpose is declared `T | undefined`. Everywhere else, build the object conditionally: `...(value !== undefined ? { key: value } : {})`.
- An index read narrows with a guard in the module's own failure shape: return its error result, throw its named error, or skip the row.
- In a test, assert the value exists (`expect(row).toBeDefined()`), never `rows[0]!`.

## Runtime

- Keep business logic in pure functions behind the boundary.
- Test with the real thing you can run. Mock only what cannot run locally.
- Log through `lib/logging.ts` with an id to debug from. Never log personal data.
