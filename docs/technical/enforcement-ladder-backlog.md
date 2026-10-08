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
| Unpaged organization reads | PostgREST stops at its row cap without an error. A reader without `.range`, `.limit`, `.single`, or `.maybeSingle` truncates silently. | Tier 2: a unit scan over `lib/` and `app/` with a reviewed allowlist for reads bounded by a small parent set. |
| One route render per mutation | A dialog can call `router.refresh()` twice for one save. No check counts the renders. | Tier 2: count the `_rsc` route requests per save in the customer browser journey. |

## Security

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Nonce script policy | `CSP_POLICY` in `lib/security/csp-report.ts` carries `'unsafe-inline'`, so the policy does not block an injected inline script. A nonce needs every page rendered per request, and `cacheComponents: true` in `next.config.ts` prerenders shells that cannot carry a per-request nonce. The `htmlSinkSelectors` lint set closes the product's own injection points meanwhile. | Tier 1, an owner decision: give up `cacheComponents`, generate a nonce per request in `proxy.ts`, drop `'unsafe-inline'`, and recalibrate the performance references. `lib/security/csp-report.test.ts` pins the policy string. |

## Code quality and maintainability

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |

## Testing and review

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Step helpers that return the optimistic echo | A mutation helper can return what the UI showed before the write persisted. | Tier 1: step helpers return the persisted row from a `db/` read or a reload. |
| Visual acceptance evidence | A slice record can cite a capture that shows a connection or readiness error. | Tier 2: validate the capture metadata and success before a record cites it. The design judgment stays Tier 3. |
| Locators of the performance specs | `tests/audit/performance/**` keep copy, structural locators and key presses. The locator-ownership rules exempt the folder. The measurement digest covers only the tests that record a scenario, so the other tests can adopt the rules now; a measured test needs a recalibration. | Tier 2: switch the rules on for the folder, with the measured tests changed in the run that recalibrates their references. |
| Classification of a repaired group | `bun run test:runs classify` refuses a group whose latest attempt passed, and a `ui:contracts` attempt inside a verification run has no run manifest, so a failure that was repaired before it was classified leaves no incident row and no classification. | Tier 2: `classify` accepts the report id and group of a past failed attempt, reads its log, and records the row. |
| Busy signals the settle step cannot see | The visual settle waits on the `animate-pulse` and `animate-spin` classes: the app shell's loading placeholders do not use `Skeleton`, no shared spinner exists, and `Button` exposes no pending state. | Tier 1: shell placeholders render `Skeleton`, a shared spinner and `Button` carry `data-slot` and `aria-busy`. Tier 2: settle on those attributes only. |

## Documentation

No open candidates.
