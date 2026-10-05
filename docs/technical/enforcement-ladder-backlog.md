# Enforcement-ladder backlog

Status: living — last reviewed 2026-10-05

This list holds the open candidates for moving a prose rule or a known gap up the ladder in [decision 0005](../decisions/0005-enforcement-ladder.md), grouped by the virtue in `AGENTS.md` that owns the rule. Each row names the rule, the gap, and the mechanism with its tier: Tier 1 makes the mistake unwritable, Tier 2 makes a check catch it. A row leaves the list in the same change that lands its mechanism, and that change adds the mechanism to the virtue's checklist. Delete a declined candidate and record the reason in the commit message. Check a row against the code before you implement it.

## UI and UX

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Dialog imports outside the wrapper | A product file can import `@radix-ui/react-dialog` or `@radix-ui/react-alert-dialog` directly and skip the refresh suspension that the `components/ui` wrappers own. | Tier 2: an import ban outside `components/ui/**` in `eslint.config.mjs`. |
| Width audit beyond the default view | `audit:layout` measures 375, 768, 1024, 1280 and 1680 px on the default view of each manager route and detail page and on the warehouse cards. Other tabs and open dialogs are not measured at any width, and any region that scrolls sideways counts as its own region, whether or not the design canon names it. | Tier 2: a registered list of tabs per route that the audit opens before it measures, and a named set of approved scroll regions, in `tests/audit/layout/mobile-viewport.spec.ts`. |
| Raw `Button` in `AlertDialogFooter` | The `werkflow-design` skill forbids it. No check rejects it. | Tier 2: a selector in `eslint-rules/ui-rules.mjs`. |
| Accessibility lint and axe sweep | ESLint runs only the accessibility rules that Next ships. No browser pass checks rendered pages. | Tier 2: enable `jsx-a11y/recommended` and add one `@axe-core/playwright` pass per role. |
| Actions the server will refuse | A view can offer an action that the server rejects. The calendar asks `isStartedOccurrence` first, but no check pairs a client action with its server rule. | Tier 2: a table of pre-checks per action kind that a unit test reads against the views. |
| Client read failure without a retry | A client hook that loads options or a section can render its failure as `ErrorText`, or as a stale notice, without a retry, so the user must reload the page or reopen the dialog. The searchable select has an `onRetryLoad` slot and the shared option hooks fill it, but no check stops a new failure without one. | Tier 1: one client-read hook that returns the data, the failure and a retry, rendered through `SectionError` with `onRetry`. Tier 2: a convention test that flags a load-failure state rendered through `ErrorText`. |
| Day view rows for personnel records without a login | The day view builds its rows from members with a login. A visit for a personnel record without a login lists under „Ohne Zuweisung“. | Tier 1: key the day rows by employee record like the board. Tier 2: an audit step that plans a visit for such a record and finds it in that person's row. |

## Performance and immediate feedback

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Attention count reads | Several readers derive the attention counts again on every debounced event and catch-up. | Measure with the typical profile first. Tier 2: a query-count test over a count-only or coalesced read. |
| Unpaged organization reads | PostgREST stops at its row cap without an error. A reader without `.range`, `.limit`, `.single`, or `.maybeSingle` truncates silently. | Tier 2: a unit scan over `lib/` and `app/` with a reviewed allowlist for reads bounded by a small parent set. |
| One route render per mutation | A dialog can call `router.refresh()` twice for one save. No check counts the renders. | Tier 2: count the `_rsc` route requests per save in the customer browser journey. |

## Security

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Nonce script policy | `CSP_POLICY` in `lib/security/csp-report.ts` carries `'unsafe-inline'`, so the policy does not block an injected inline script. | Tier 1, scheduled by the owner: generate a nonce per request in `proxy.ts`, render authenticated routes per request, drop `'unsafe-inline'`, and recalibrate the performance references. `lib/security/csp-report.test.ts` pins the policy string. |
| Organization column on every public table | `supabase/tests/security_boundaries.sql` requires RLS on every public table. It does not require an organization column. | Tier 2: extend that SQL test with a named allowlist of global tables. |
| Destructive migrations carry a marker | The protocol asks for a reviewed reason. No check finds an unmarked destructive statement. | Tier 2: a SQL lint that requires a `-- @destructive: <reason>` comment. |
| Retired database functions | `renew_employee_capability` has no caller in the current code and stays until the build that still calls it is replaced ([migration rule](environments.md#the-migration-rule), item 8). No check lists functions that no code calls. | Drop it in a migration after the next production release. Tier 2: a check that compares the public functions with the names the code calls. |
| Auth configuration and advisor checks | No command compares the Auth configuration of the projects or runs the Supabase advisors. | Tier 2: one comparison command and one advisor command next to `types:check` and `migrations:check`. |
| Server-generated files in Server Actions | `lib/security/storage-import-boundary.test.ts` keeps the R2 client out of client code. `lib/time-accounts/actions.ts`, `lib/work-artifacts/actions.ts` and `lib/work-handover/actions.ts` are `'use server'` modules that write generated files with `putStorageObject`, and nobody has decided whether they need a narrower boundary. | Decide the scope first. Tier 2: extend the boundary test if the answer is yes. |
| One owner helper for action context | `resolveActionContext` in `lib/org/action-context.ts` returns user, organization and role, but few domains use it. The others resolve them their own way, and `lib/security/server-action-authorization.test.ts` accepts any call whose name matches an identity-helper list or pattern (`require*`, `authorize*`, `getAuthorized*Context`). The test proves that a check is present, not which one. | Tier 1: build every domain helper on `resolveActionContext`. Tier 2: narrow the test to that helper and its named wrappers. |

## Code quality and maintainability

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Detail loaders that hide a failed section read | The pages mark a failed section read with `null`, a `…LoadFailed` prop or a page-level `RegionLoadError`, but nothing stops a new page from writing `result.success ? result.items : []` or `data ?? []` and showing "none" for a failure. | Tier 2: a unit scan over `app/**/page.tsx` for an empty fallback on a read result whose failure reaches no prop or region. |
| Read errors behind `loggedRead` | `lib/conventions/read-error-visibility.test.ts` covers raw Supabase reads only. A `loggedRead` call logs the error and hands back `data: null`, and most of its sites treat that as a refusal or as absence: a failed read then says „nicht gefunden“ or skips a pre-check. | Tier 2: give `loggedRead` sites a refusal code for the failure (`load_failed`) and extend the scan to them. |
| Status-guarded update without a status filter | An action can read a row, check its status and update it by id alone, so a change between the read and the write is overwritten. | Tier 2: a scan over the server actions that pairs a status check on a read row with an `.update()` that lacks the status filter. |
| Column preferences of one user | Saving an Aufträge column preference reads the whole preference document and writes it back. Two saves of different keys by the same user within one round trip lose one of them. | Tier 1: an RPC that sets one key atomically. Tier 2: an action test with two concurrent saves. |
| Silent best-effort `catch` blocks | A `catch` that only logs can hide a failure the user needs to see. The sign-out cleanup in `hooks/use-sign-out.ts` is the known site. | Tier 2: triage each site, then add a `CatchClause` selector that requires a returned failure or a named best-effort annotation. |
| Local time and duration formatters | `formatTime`, `formatDuration`, `formatMinutes` and `formatRange` still have copies in `components/`, and `formatTime` and `formatRange` have no home in `lib/`. `lib/conventions/duplicate-helpers.test.ts` freezes the counts. | Tier 1: give each formatter one home in `lib/`, then each UI pass adopts it and lowers the count until the entry is gone. |
| Dependency denylist | A banned package can enter `package.json` without a decision record. Only the `sonner` import is a lint error. | Tier 2: a unit test over `package.json` with the denied names and the decision that bans each. |

## Testing and review

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Measurement digest scope | A scenario's measurement digest covers the whole spec file. An edit outside the measured test orphans the references. | Tier 2: hash the measured test body and the helpers on its path. Keep the file digest for the workload identity. |
| Count equality between two live locators | A spec can compare two `count()` results once and race the badge it reads. | Tier 2: an ESLint selector in `eslint-rules/playwright-spec-rules.mjs`. Poll with `expect.poll`. |
| Golden tag for every complete slice | A roadmap row can say `complete` without a golden test that carries the slice tag. | Tier 2: compare the roadmap rows with the Playwright `--list` output. |
| Incident rows written by hand | `bun run test:runs classify` records the class, and an agent then writes the incident-log row by hand. | Tier 1: the command appends the row. |
| Convention scans skip the canary | The helper-use and date-ownership scans do not read `tests/canary/**`. | Tier 2: add the canary folder to both scans. |
| Step helpers that return the optimistic echo | A mutation helper can return what the UI showed before the write persisted. | Tier 1: step helpers return the persisted row from a `db/` read or a reload. |
| Local builds that replace `.next` | `bun run build` and `bun run dev` can replace the recorded build while a test server uses it. | Tier 2: extend the ownership check of `build:test` to those entry points. Keep the hosted build unchanged. |
| Commands outside the workspace lock | A raw local reset and a directly invoked `bun test` do not take the lock. | Tier 2: route the remaining infrastructure commands through the lock. |
| Backend health during a run | The runner checks the backend before a run. A service that fails later looks like a product failure. | Tier 2: bounded health evidence for the application-to-backend path, recorded with the group result. |
| Diagnostic replay after partial writes | A replay on a retained world can repeat a stage whose writes already persisted. | Tier 2: each diagnostic stage declares an idempotent precondition, and the runner prints the last completed checkpoint before the replay. |
| Visual acceptance evidence | A slice record can cite a capture that shows a connection or readiness error. | Tier 2: validate the capture metadata and success before a record cites it. The design judgment stays Tier 3. |
| Locators of the performance specs | `tests/audit/performance/**` keep copy, structural locators and key presses. They are measurement-digest inputs, so an edit orphans every reviewed reference, and the locator-ownership rules exempt them. | Tier 2: switch the rules on for them in the change that narrows the measurement digest (row above) or recalibrates the references. |
| Copy passed to area helpers | The copy rule checks Playwright calls and a fixed list of shared text helpers. A spec can still pass wording to another helper's text parameter, or wrap it in `testData`. | Tier 2: type helper text parameters as keys or a branded test-data type, and reject a `testData` template without an interpolated value. |
| Authoring proof per test | `authoring` is accepted when the group's test inputs never passed. Passes are not recorded per test title and body, so a change plan cannot list the unproven tests. | Tier 2: the discovery reporter records passes per title and body hash, and the plan prints the unproven titles. |
| Busy signals the settle step cannot see | The visual settle waits on the `animate-pulse` and `animate-spin` classes: the app shell's loading placeholders do not use `Skeleton`, no shared spinner exists, and `Button` exposes no pending state. | Tier 1: shell placeholders render `Skeleton`, a shared spinner and `Button` carry `data-slot` and `aria-busy`. Tier 2: settle on those attributes only. |

## Documentation

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Roadmap states and progress-log link | `docs:check` accepts an unknown slice state and an accepted record without its progress-log entry. | Tier 2: extend `scripts/check-docs.ts`. |
| Feature-spec review date | A spec can keep an old review date after a slice that names it as primary spec is accepted. | Tier 2: `docs:check` compares the roadmap acceptance dates with each spec's status line. |
| Route handler names in docs | A backticked `app/api/<name>` in a doc can name a handler that no longer exists. | Tier 2: `docs:check` compares the names with the folders under `app/api/`. |
| References to numbered testing rules | Living docs can cite "testing rule N", which resolves to nothing. | Tier 2: `docs:check` rejects the phrase outside closed records. |
| Test paths in skills | A backticked `tests/` path in a skill goes stale when a spec or support module moves. | Tier 2: `docs:check` resolves those paths in `.claude/skills/**` and `.agents/skills/**`. |
| Cross-repository links | `docs:check` validates outgoing sibling links only. It does not check sibling indexes, incoming links, or shared skill copies. | Tier 2: a workspace link, index, and mirror check that reports a missing clone. |
| Imperatives in closed plans | A closed plan can keep an imperative that an agent might execute. | Tier 2: `docs:check` flags imperative sentence openings in closed docs outside sections marked historical. |