# Code quality and maintainability

This doc owns virtue 4 in `AGENTS.md`: how to reach good code, the deletion pass and the independent review. The `typescript-best-practices` skill owns the type patterns. Lint, the compiler and the tests under `lib/conventions/` enforce the mechanical rules; their messages name the fix.

## How to work

### Place new code

1. Search for the rule's owner with `git grep` under `lib/` before you write it. A domain rule lives in `lib/<domain>/` beside its `actions.ts`, `types.ts` and tests, as in `lib/requests/`.
2. Put a component under `components/<area>/`, in the folder of its concern, such as `components/auftraege/lifecycle/`.
3. Split by concern before a file nears its limit in `eslint-rules/size-caps.mjs`. When you touch an entry of `eslint-rules/size-cap-exceptions.json`, split it and lower or remove the entry. A shrink lowers the ceiling in the same change.

Wrong turn: a copy of a helper or a type in the file that needs it. The copies drift, and `lib/conventions/duplicate-helpers.test.ts` fails on a repeated name or a copied body.

### Reuse before you write

| Need | Home |
| --- | --- |
| Validate an id | `uuidSchema` or `isUuid` in `lib/validation/uuid.ts`. `z.uuid()` rejects real production ids. |
| Return a result | `ActionResult` or `ActionFailure` in `lib/action-result.ts`. A failure names a snake_case code; extra facts are typed fields beside it. |
| Say a failure in German | `describeFailure` in `lib/action-messages.ts`. A shared code has its one sentence there; a surface lists only its own codes. A failure that names facts uses a `FailureSentence`, as `lib/time-tracking/validation-messages.ts` does. |
| "Today", zone, date arithmetic | `lib/date-time/berlin.ts`; `getBusinessTodayIso` for a business decision. |
| A date or time label | `formatBerlin` and its siblings in `lib/utils.ts`; `formatLocalCalendarDay` for a picker's local day. |
| Running minutes, a render tick | `liveMinutes` in `lib/time-tracking/helpers.ts`; `useWallClockTick` in `hooks/use-wall-clock-tick.ts`. |
| Pages and id lists | `lib/supabase/query-batches.ts`. |
| Database shapes | `lib/supabase/database.types.ts`. |
| A page's caller and role | `resolvePageMembership` in `lib/org/page-context.ts`; `OrgRole` in `lib/roles.ts`. |
| A full document load | `loadDocument` in `lib/navigation/document-load.ts`, only after a session, account or organization change. Otherwise the router. |

After you add a module-level helper or an exported type, run `bun run test:unit lib/conventions`.

Wrong turn: the runtime's local date or a hand-written failure type. Both pass review and break at midnight or at the next caller.

### Name and type it

1. Name with full words that read without context. Flatten nested conditions with guard clauses.
2. Parse external data at its boundary (Server Action, route handler, Supabase response) into a named domain type. Declare parameter and return types on every export under `lib/`.
3. Put a rule in a type where it fits: a `Record` over a code union makes a missing case a compile error, as `lib/calendar/messages.ts` does.
4. Narrow a check-constrained text column with `constrainedValue` (`lib/validation/constrained-value.ts`), a `jsonb` payload with `isJsonRecord` or `jsonRecordOrEmpty` (`lib/supabase/json.ts`).
5. Run `bun run typecheck` and `bun run lint <files>`.

Wrong turn: an `as` cast or a `!` to quiet the compiler. The strict flag points at a real missing case; a cast hides a wrong row type until a reader trips over it.

### Write related rows

A user action that changes more than one row, or one row plus its history, audit, stock or link rows, changes all of them in one database function call. A refusal at any step then leaves nothing applied.

1. Copy `supabase/migrations/20261003110000_apply_time_entry_batches_atomically.sql`. The action authorizes and passes only server-resolved values. The function locks the rows, repeats the state checks, raises the action's failure code, pins `search_path`, and grants execute to `service_role` only.
2. Call it through `rpcArgs` (`lib/supabase/rpc-args.ts`). Map refusals with `writeRefusalFor` or `rowWriteResultFor` (`lib/supabase/write-refusal.ts`).
3. Keep every side effect of the old sequence: history and audit rows, published-table writes, cache tags.
4. Prove it in SQL as `supabase/tests/closed_period_writes.sql` does: a refused later step changes nothing, success works, a foreign organization is refused, the grants hold.
5. A function that writes a job's visits or team keeps the [job team and visit plan](data-model.md#job-team-and-visit-plan) rules; add the path to `supabase/tests/job_plan_bridge.sql`.

A write that depends on a state the action read (a status, a version, a quantity) filters on that state, so a change in between leaves zero rows and the action reports it stale. A save of one key in a shared JSON document sets that key in one call and never writes back the document it read.

Wrong turn: consecutive writes with a compensating delete on failure. The delete can be refused too, by append-only history or an `on delete restrict` reference, and the half-applied state stays.

### Show every failure

A failed Supabase read becomes a failure the page shows with a retry (`SectionError`, `RegionLoadError`), never `[]`, `{}` or a missing row. A `loggedRead` site maps its error to `load_failed` before any missing-row guard, so „nicht gefunden“ means absence only. A `catch` that only logs names its best-effort reason.

### Finish the change

1. Run `bun run unused:check` and delete what it lists. Its second pass also lists an export only a test imports. A deliberate test seam carries `@internal` with its reason.
2. Do the [deletion pass](#deletion-pass-and-independent-review), then hand the diff to a different session for the independent review.
3. Fill in the **Deletion pass** section of the PR: what the pass removed, or "nothing to remove" with the reason.

Wrong turn: code kept for possible future scope. Every later agent reads, maintains and copies it.

## Never

- Use `any`, a non-null assertion `!`, or an `as` or `<T>` assertion (`as const` stays). A file on `eslint-rules/type-assertion-ratchet.json` keeps at most its recorded count; review judges an `as` added in a listed file.
- Pass `undefined` into an optional property, or silence a strict flag with a cast or `@ts-expect-error`.
- Write a uuid regex outside `lib/validation/uuid.ts`.
- Write to `console` in product code. Log through `logError`; a component shows the failure.
- Write related rows in consecutive statements, or repair a failed step with a compensating write.
- Copy a helper or a type into a second file.
- Read the runtime's local date for a business decision.
- Build a React `key` from a mapped or joined collection. A remount for fresh data uses a `resetKey`.
- Exempt or suppress a size limit to fit new code. Split the function.
- Suppress a rule without a `-- reason`.
- Import from `components/` in `lib/`.
- Add a package that a decision or an owner doc bans.
- Add an abstraction for possible future scope.
- Remove authorization, validation, audit history or failure visibility to save lines.
- Rename existing short identifiers in passing. The owner decided this.

## Verify your work

Run `bun run typecheck`, `bun run lint` (a warning fails like an error), `bun run unused:check`, `bun run format:check` and `bun run test:unit`. Then do the deletion pass and the independent review below.

## Deletion pass and independent review

Both happen after the selected test groups pass and before the PR merges. The PR template records the deletion pass. The CodeRabbit review and the finding dispositions live in the PR threads.

1. **Deletion pass, by the session that wrote the code.** Walk the diff file by file (`git diff --stat HEAD` plus untracked files). For every added file, export, function, branch, state variable, effect, wrapper and dependency, ask whether the outcome survives without it. Delete what does not earn its place. Fold a one-caller helper into its caller. Replace a copy with an import. Run `bun run test:verify`. Record the `git diff --shortstat` line before and after and what the pass removed, in the PR and in the commit's `Deletion pass:` line.
2. **Independent review, by a different session.** A fresh context reads the diff against the outcome and the six virtues, then runs `bun run review` on it (`--uncommitted` while unpublished, `--base-commit <sha>` after an intermediate commit). Over CodeRabbit's file limit, review in directory passes (`--dir app`, `--dir components`, `--dir lib`) and name the directories left uncovered. Each finding gets one row: the finding, its disposition (repaired, declined with the reason, deferred with its owner) and, for a kept finding, the tier where its prevention landed.

A failed reviewer launch is no review; record it as missing. CodeRabbit adds to the fresh reviewer's judgment and does not replace it.
