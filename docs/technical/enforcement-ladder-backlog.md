# Enforcement-ladder backlog

Status: living — last reviewed 2026-10-09

This list holds the open candidates for moving a prose rule or a known gap up the ladder in [decision 0005](../decisions/0005-enforcement-ladder.md), grouped by the virtue in `AGENTS.md` that owns the rule. Each row names the rule, the gap, and the mechanism with its tier: Tier 1 makes the mistake unwritable, Tier 2 makes a check catch it. A row leaves the list in the same change that lands its mechanism, and that change adds the mechanism to the virtue's checklist. Delete a declined candidate and record the reason in the commit message. Check a row against the code before you implement it.

## UI and UX

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Calendar approvals by the responsibility holder | The calendar's entry details offer approval and block moves by role (`canManageBlock`, `canApproveEntries`), while the server asks the `time_approval` holder. `lib/ui/action-prechecks.ts` marks these rows reviewed, so a manager who is not the holder can start an approval the server refuses. | Tier 2: the calendar reads the holder through the approval read model and the pre-check table pairs the views with `canHolderApproveTarget`. |
| Phone paths of desktop-only dialog openers | Some dialogs of `lib/testing/selection/dialog-inventory.ts` open from a table row menu, the board or the day timeline (`opensOn: 'desktop'` in `tests/audit/support/dialog-openers/`). At 375 px the audit opens them on the desktop and narrows the window, so the phone's own path (a card menu, the day list) is not driven. | Tier 2: an opener per phone path in the area modules, audited at 375 px. |

## Performance and immediate feedback

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Effect-started reads behind `useClientRead` | `lib/conventions/live-view-reads.test.ts` lists Server Action reads that start from an effect (`useClientRead` counts as an effect start): they wait in the Server Action queue behind saves. | Tier 2: move each to a kind in `lib/data/background-reads.ts` until the list is empty. |

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
| Locators of the performance specs | The locator-ownership rules cover `tests/audit/performance/**`. The measured tests still keep copy in their locators: PERF-02 in `calendar.spec.ts`, PERF-L2 in `lists.spec.ts`, PERF-F2 in `field.spec.ts` and the test in `planning-benchmark.spec.ts`. Their code is a measurement-digest input, so each sits inside an `eslint-disable` block that names its scenarios and gives the reason. Each changes only in the run that recalibrates its references. | Tier 2: in that run, move the test's copy into its area module and remove its disable block. |
| Classification of a repaired group | `bun run test:runs classify` refuses a group whose latest attempt passed, and a `ui:contracts` attempt inside a verification run has no run manifest, so a failure that was repaired before it was classified leaves no incident row and no classification. | Tier 2: `classify` accepts the report id and group of a past failed attempt, reads its log, and records the row. |

## Documentation

No open candidates.
