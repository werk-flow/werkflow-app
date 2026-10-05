# Code quality and maintainability

Status: living — last reviewed 2026-10-03

This doc owns virtue 4 in `AGENTS.md`. Good code here is the smallest amount of clear code that delivers the confirmed outcome. A domain rule has one owner module with precise types and focused tests. The `typescript-best-practices` skill owns the type patterns. This page owns the checklist, the prohibitions, the deletion pass and the independent review.

## How to work

### Place new code

1. Before you write a rule, search for its owner with `git grep` under `lib/`. A domain rule lives in `lib/<domain>/` beside the domain's `actions.ts`, `types.ts` and their tests, as in `lib/requests/`.
2. Put a component under `components/<area>/`, in the folder of its concern, such as `components/auftraege/lifecycle/`.
3. Split by concern before a file nears its size limit. `bun run lint <files>` fails on a file or function over its limit.

Wrong turn: a copy of a helper in the file that needs it. The copies drift apart, and `lib/conventions/duplicate-helpers.test.ts` fails on the repeated name.

### Reuse before you write

1. Validate an id with `uuidSchema` or `isUuid` from `lib/validation/uuid.ts`.
2. Return `ActionResult` or `ActionFailure` from `lib/action-result.ts`, and turn a code into German with `describeFailure` from `lib/action-messages.ts`.
3. Take "today" from `getBusinessTodayIso`, pages and id lists from `lib/supabase/query-batches.ts`, and database shapes from `lib/supabase/database.types.ts`.
4. After you add a module-level helper, run `bun run test:unit lib/conventions`.

Wrong turn: the runtime's local date or a hand-written failure type. Both look fine in review and break at midnight or at the next caller.

### Name and type it

1. Name with full words that read without their context, and flatten nested conditions with guard clauses.
2. Parse external data at its boundary into a named domain type, and declare parameter and return types on every export under `lib/`.
3. Where a rule can live in a type, put it there: a `Record` over a code union makes a missing case a compile error, as `lib/calendar/messages.ts` does.
4. Run `bun run typecheck` and `bun run lint <files>`.

Wrong turn: an `as` cast or a `!` to quiet the compiler. The strict flag that complained points at a real missing case.

### Write related rows

A user action that changes more than one row, or one row plus its history, audit, stock or link rows, changes all of them in one call of a database function. A refusal at any step then leaves nothing applied.

1. Copy `supabase/migrations/20261003110000_apply_time_entry_batches_atomically.sql`. The action establishes identity, organization, role and object permission and passes only values the server resolved. The function locks the rows, repeats the state checks, raises the action's failure code for the first refusal, pins `search_path`, and grants execute to `service_role` only.
2. Call it through `rpcArgs` from `lib/supabase/rpc-args.ts`, and map its codes to the action's existing failure codes.
3. Keep every side effect of the old sequence: history and audit rows, writes to published tables for live signals, and the cache tags the action revalidates.
4. Prove it in SQL as `supabase/tests/closed_period_writes.sql` does: a refused later step changes nothing, the success path works, a foreign organization is refused, and the grants hold. Register the file in `sqlDefinitions` and run its group.
5. A function that writes a job's visits or its team keeps the [job team and visit plan](data-model.md#job-team-and-visit-plan) rules: it writes the plan onto the job through `app_private.project_plan_onto_job` and never sets `app.planning_projection_write` itself. Add the new path to `supabase/tests/job_plan_bridge.sql` and run `sql:job-plan-bridge`.

Wrong turn: consecutive writes with a compensating delete on failure. The delete can be refused too, by an append-only history or an `on delete restrict` reference, and the half-applied state stays.

### Finish the change

1. Run `bun run unused:check` and delete what it lists.
2. Do the [deletion pass](#deletion-pass-and-independent-review), then hand the diff to a different session for the independent review.
3. Record both in the slice record, or outside a slice in the commit message body.

Wrong turn: code kept for possible future scope. Every later agent reads it, maintains it and copies it.

## Checklist

A `[judgment]` item is a Tier 3 default: diverge only with the note that `AGENTS.md` describes under "How to read the virtues".

- The change delivers the confirmed outcome with the least code that stays clear. [judgment]
- Each domain rule has one owner module, and other files import it. [test `lib/conventions/duplicate-helpers.test.ts`]
- A new module-level helper name is declared in one product file only, and no helper body is copied under another name. [test `lib/conventions/duplicate-helpers.test.ts`]
- Every exported function under `lib/` declares its parameter and return types. [lint `@typescript-eslint/explicit-module-boundary-types`]
- The code compiles under the strict flags, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. [code `tsconfig.json`, group `static:typecheck`]
- External data is parsed at its boundary (Server Action, route handler, Supabase response) into a named domain type. The test covers Server Action parameters; for a route handler or a Supabase response the reviewer looks for a schema or a typed mapper before the first use. [test `lib/conventions/server-action-input.test.ts`, judgment]
- An id is validated with `uuidSchema` or `isUuid` from `lib/validation/uuid.ts`. [code `lib/validation/uuid.ts`, lint `uuidSelectors`]
- A database shape derives from `lib/supabase/database.types.ts`, and the generated types match the DEV schema. [script `types:check`]
- A Server Action or reader returns `ActionResult` or `ActionFailure` from `lib/action-result.ts` with a stable error code. A richer failure intersects `ActionFailure<Code>` with its extra fields instead of declaring its own `success: false` type. [code `lib/action-result.ts`, test `lib/conventions/action-failure-shape.test.ts`]
- A surface turns a failure code into German through `describeFailure` from `lib/action-messages.ts`. A code in `SHARED_FAILURE_CODES` has its one sentence there; a surface lists only the codes its area owns. A message map drops a code that no action, client check or database function names any more. [test `lib/action-messages.test.ts`, test `lib/conventions/failure-messages.test.ts`]
- Rows that one action changes together change in one database function call, all or nothing, as [write related rows](#write-related-rows) describes. [test `lib/conventions/related-writes.test.ts`]
- A write between a job's team and its visit plan keeps the [job team and visit plan](data-model.md#job-team-and-visit-plan) rules, and only `app_private.project_plan_onto_job` writes the plan onto the job. [group `sql:job-plan-bridge`]
- An internal navigation goes through the router. A deliberate full document load, after a session, account or organization change or to a non-page target, goes through `loadDocument`. [code `lib/navigation/document-load.ts`, lint `@next/next/no-location-assign-relative-destination`]
- A failure reaches the user or the log. A `.catch` that ends in nothing handles its null on the next lines or logs. [lint `swallowedRejectionSelectors`]
- A failed Supabase read becomes a failure that the page shows with a retry, never `[]`, `{}` or a missing row. A deliberate best-effort read has a reviewed reason. [test `lib/conventions/read-error-visibility.test.ts`]
- "Today" for a business decision is the Berlin business date from `getBusinessTodayIso`. [test `lib/conventions/business-date.test.ts`]
- A React `key` names a stable identity. A remount for fresh data uses a `resetKey`. [test `lib/conventions/collection-keys.test.ts`]
- A module stays under 2,000 lines, a component or route file under 500, and a function under 200. A file or function that outgrows its limit is split, never exempted or suppressed. [lint `max-lines`, lint `max-lines-per-function`, test `lib/conventions/module-caps.test.ts`]
- `lib/` imports nothing from `components/`. [lint `libToComponentsPattern`]
- Every lint suppression names its rule and carries a `-- reason`. [lint `@eslint-community/eslint-comments/require-description`, lint `reportUnusedDisableDirectives`]
- Nothing is left unused: no file, export, dependency, local or parameter. [group `static:unused`, group `static:typecheck`]
- The formatting matches Prettier. [group `static:format`]
- Names are descriptive full words, and control flow uses guard clauses. The reviewer reads each new name without its context and flags nested `if` chains that an early return would flatten. [judgment]
- The deletion pass and the independent review below are recorded. [judgment, script `docs:check`]

## Never

- Use `any`. [lint `@typescript-eslint/no-explicit-any`]
- Use a non-null assertion `!`, in product code or in any test. [lint `@typescript-eslint/no-non-null-assertion`]
- Cast through `unknown` (`value as unknown as T`) in product code. [lint `doubleCastSelectors`]
- Pass `undefined` into an optional property, or silence a strict flag with a cast or `@ts-expect-error`. [group `static:typecheck`, judgment]
- Use `z.uuid()` or `z.string().uuid()`. They reject real production ids. [lint `uuidSelectors`]
- Write to `console` in product code. Server code, and client code that has nothing to show, logs through `logError` from `lib/logging.ts`; a component shows the failure. [lint `no-restricted-properties`, lint `no-console`]
- Write related rows in consecutive statements, or repair a failed step with a compensating write. [test `lib/conventions/related-writes.test.ts`]
- Escape a character that needs no escape in a string or a regular expression. [lint `no-useless-escape`]
- Copy a helper into a second file instead of importing its home. [test `lib/conventions/duplicate-helpers.test.ts`]
- Read the runtime's local date for a business decision. [test `lib/conventions/business-date.test.ts`]
- Build a React `key` from a mapped or joined collection. [test `lib/conventions/collection-keys.test.ts`]
- Exempt or suppress a size limit to fit new code. [test `lib/conventions/module-caps.test.ts`]
- Suppress a rule without a reason. [lint `@eslint-community/eslint-comments/require-description`]
- Add an abstraction for possible future scope. [judgment]
- Remove authorization, validation, audit history or failure visibility to save lines. [judgment]
- Rename existing short identifiers in passing. The owner decided this. [judgment]

## Verify your work

1. Run `bun run typecheck`. A pass prints no error.
2. Run `bun run lint`. A pass prints no problem; a warning fails it like an error.
3. Run `bun run unused:check`. A pass lists no unused file, export or dependency.
4. Run `bun run format:check` on the files you touched.
5. Run `bun run test:unit`. The convention tests under `lib/conventions/` run there and must pass.
6. Do the deletion pass below and record it.
7. Have a fresh session do the independent review below. Record a disposition for each finding.
8. Before a push, `bun run test:verify` runs all static gates again. The publication gate refuses a push without a passing report and a review record.

## Deletion pass and independent review

Both happen after the selected test groups pass and before the slice record closes. Outside a slice, record both in the commit message body.

1. **Deletion pass, by the session that wrote the code.** Walk the diff file by file (`git diff --stat HEAD` plus untracked files). For every added file, export, function, branch, state variable, effect, wrapper and dependency, ask whether the outcome survives without it. Delete what does not earn its place. Fold a helper with one caller into that caller. Replace a copy with an import of its home. Then run `bun run test:verify`. Record the pass in the slice record under `## Deletion Pass And Review`: the `git diff --shortstat` line before and after, and what the pass removed.
2. **Independent review, by a different session.** A fresh context that did not write the code reads the diff against the bounded outcome and the six virtues. It then runs `bun run review` on the diff (`--uncommitted` while the work is unpublished, `--base-commit <sha>` after an intermediate commit). When the diff exceeds CodeRabbit's file limit, review it in directory passes (`--dir app`, `--dir components`, `--dir lib`) and name the directories the review did not cover. Each finding gets one row: the finding, the disposition (repaired, declined with the reason, or deferred with its owner) and, for a kept finding, the tier where its prevention landed.

A failed reviewer launch is not a completed review. CodeRabbit adds to the fresh reviewer's judgment and does not replace it. Record a missing review as missing. `docs:check` rejects a closed slice record without the section, the two shortstat lines or the review command. [CodeRabbit](coderabbit.md) owns the review command.

## Examples

- `lib/supabase/query-batches.ts`: one owner module for batched and complete reads, with typed signatures, guard clauses and a comment that states the reason for each limit.
- `lib/calendar/messages.ts`: a `Record` over the whole result-code union, so a new code without a German sentence fails `tsc`. Copy this when a rule can live in a type.
- `lib/validation/uuid.ts`: the one home of a validator, with the reason the lint ban points at.
