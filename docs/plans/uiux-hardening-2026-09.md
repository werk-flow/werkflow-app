# UI/UX Hardening 2026-09

Status: living — last reviewed 2026-09-03; the pre-handoff UI/UX hardening ledger, closes when every phase below is verified

Owner-directed pass between the Wave 2 acceptance and the beta-client handoff. The 2026-08 consolidation ([uiux-consolidation.md](uiux-consolidation.md)) wrote the canon and migrated the surfaces that existed then; sixty-one UI files shipped after it. This ledger records what a fresh audit found on 2026-09-03, whether each finding was missed by the consolidation, a regression against a written rule, or a rule the canon never stated, and what climbed the enforcement ladder ([decision 0005](../decisions/0005-enforcement-ladder.md)). The canon itself lives in the `werkflow-design` skill; this file is the record, not the rule.

## Owner rulings (2026-09-03)

1. Custom controls on every viewport of the web app; native pickers belong to the future React Native app only.
2. Time rules move into the Zeiterfassung area as a real subpage; Settings links there. No area tab leaves its area.
3. Every field renders through `Field`; required fields carry the marker; submit buttons are never pre-disabled as a validation hint (exception: forms with at most two obvious required fields).
4. Rows that do nothing on click have no hover, and neither do their skeletons.
5. No page-level horizontal scroll on any viewport; tables get card layouts below the tablet breakpoint; nothing is cropped to comply. Named exceptions: calendar day and week grids, the signature pad.
6. Focused browser proofs after each phase on the local stack; the full certification runs once at the end of the thread.
7. The whole pass runs on the recommended basis, start to finish, in one session.

## Classification

Origin: `pre` = existed at the 2026-08-22 consolidation close; `post` = built after it. Class: `missed` (existed, not caught), `regression` (built after the canon, against a written rule), `gap` (no rule existed).

| # | Finding | Where | Origin | Class | Fix and tier |
| --- | --- | --- | --- | --- | --- |
| 1 | Strict zod uuid check rejects the hand-made production organization ids; the clock and every P1-21+ flow returned `invalid_input` silently for those tenants | 165 validators across all Wave 1/2 domains | post (P1-21 onward) | gap | One `uuidSchema` in `lib/validation/uuid.ts` (Tier 1); ESLint bans the strict check elsewhere (Tier 2); unit test pins the production id shape |
| 2 | Labels glued to controls | 23 stacks in `work-templates-content`, `job-instruction-items-card`, `work-artifacts-section`, `project-qualification-section` | post (P1-13, P1-15) | gap | `Field` primitive owns the stack (Tier 1); `ui/label-in-spaced-container` lint (Tier 2) |
| 3 | No page container; `/service/*` flush against the sidebar with no scroll region; field work pack and handover clip on phones; five padding spellings | 30 pages | post (service) / pre (rest) | gap | `PageShell`, `PageHeader`, `PageBody` (Tier 1); lint on the raw column literals (Tier 2) |
| 4 | Zeiterfassung has no layout: header exists only on the overview, route tabs look like state tabs, one tab leaves the area, loading state renders the live header with the wrong tab count, subpages have no loading state | `/zeiterfassung/*` | post (P1-23) | gap | Area `layout.tsx` with `PageHeader` eyebrow and `AreaNav` (Tier 1); subpage loading files; time rules moved into the area |
| 5 | Service nav pasted into each page body; missing on the equipment detail and in every service skeleton | `/service/*` | post (P1-18 to P1-20) | gap | Same layout model as 4 |
| 6 | Document scrolls under the app bar and sideways on phones | app shell root (`h-screen`, no width constraint) | pre | missed | Shell owns the viewport (`h-dvh`, `overflow-hidden`, `min-w-0`) (Tier 1); 375 px viewport audit (Tier 2) |
| 7 | Anfragen filter strip: search input crushed under the refresh icon on phones, tapping opens the keyboard | `anfragen-content.tsx` | pre | missed | Strip stacks below `sm` |
| 8 | Date and time pair overflows phone sheets | `DateTimeField` | pre | missed | Container query stacks the pair under 20 rem |
| 9 | Clock error box translucent; retry deterministic because of finding 1 | `clock-fab.tsx` | post (P1-21) | gap | Opaque card surface; retry works once finding 1 landed |
| 10 | Thirteen raw `Select`s over entity lists, two over long enums | service dialogs, artifacts, inventory | post / pre | regression (rule existed) | Migrate to searchable components; development-time option-count guard in `Select` (Tier 1 for growth) |
| 11 | Native `type="month"`, one native checkbox, one native range | Perioden, inventory, avatar | post / pre | gap (lint did not cover these types) | Month picker on `DatePicker`; `Checkbox`; registry row for the slider; lint covers the types (Tier 2) |
| 12 | 38 raw error paragraphs, ten without `role="alert"` | 30 files | mixed | regression | `ErrorText` everywhere; lint bans raw `role="alert"` outside `components/ui` (Tier 2) |
| 13 | Five hover tokens; default table row hovers without a click target; clickable template cards without hover | lists app-wide | pre | gap | `TableRow interactive` and `ListRow interactive` own the one token (Tier 1); default hover removed |
| 14 | Generic bar skeletons over real tables and tab strips; skeleton hover absent where rows hover | service, Aufgaben, Anfragen, Arbeitsvorlagen, Mitarbeiter, Inventar | mixed | gap | `SkeletonTable`/`SkeletonRows`/`SkeletonList` from the list's column definition (Tier 1); pairing unit test (Tier 2) |
| 15 | Pending feedback: 51 button-only, 25 silent, 4 skeleton-after-action mutation sites; `useTransition` pending on eight refresh controls; success banners before persistence in calendar drag; the live-view optimistic echo unused | 118 call sites | mixed | gap | Pending-feedback matrix in the canon; `useServerAction` settling phase, `useOptimisticList`, `PendingRow`, `InlinePending`, `useBusyIds`, `useBatchProgress` (Tier 1); `useTransition` banned in product code (Tier 2) |
| 16 | Horizontal scroll on phones from tab strips, fixed-width columns, wide cards | Mitarbeiter, Inventar, Aufträge, Dokumente, calendar | pre | gap | Card layouts and self-scrolling strips; viewport audit (Tier 2) |
| 17 | `Button` has no pressed state; submit buttons pre-disabled on several forms | primitives, forms | pre | gap | `active:` states on every variant; submit rule in the canon |

## Phases

Each phase ends with lint, typecheck, the unit suite, `docs:check`, a focused browser proof of the touched areas on the local stack, and a commit pushed to `partner-preview`.

- [x] **Phase 0, live defects.** Findings 1, 6, 7, 8, 9. Proof: `@GG-00`.
- [x] **Phase 1, canon and primitives.** Canon amendments in the skill; primitives and hooks from findings 2, 3, 13, 14, 15, 17; the label lint and the uuid lint; the 23 glued labels fixed. Proof: `@GG-00`, `@P1-13`.
- [x] **Phase 2, layout.** Every page onto the shell (raw column literals now lint-banned); Service and Zeiterfassung `layout.tsx` with `AreaNav`; time-account rules moved to `/zeiterfassung/einstellungen` with Settings linking there; content-only subpage loading states; headers outside the data boundary on Aufträge, Anfragen, Arbeitsvorlagen and the service lists; inventory, member, invitation, document and job tables with card layouts below `md`; the settings shell on the primitive. Accepted leftovers, carried into later phases: the calendar header still sits inside its data boundary because it is bound to the container state; detail-page loading skeletons keep fixed-width rows until the Phase 4 skeleton sweep. Canon wording to reconcile at closure: area layouts render the area name as the `h1` title and subpages an `h2`, not an eyebrow.
- [ ] **Phase 3, forms.** `Field` migration by area; `ErrorText`; entity selects; month picker, checkbox, slider; required markers; submit rule; delete-org footer.
- [ ] **Phase 4, skeletons and hover.** Column definitions exported per list; structural skeletons; hover fidelity; spinner-only sections to section skeletons.
- [ ] **Phase 5, pending feedback.** Skeleton-after-action sites first, then silent sites, then dialog creates onto pending rows and optimistic lists; the calendar banner order; the clock echo; `useTransition` ban.
- [ ] **Phase 6, closure.** Ledger closed, backlog rows retired or added with tiers, technical docs reconciled, checker green.

## Verification record

| Date | Phase | Statics | Browser proof | Commit |
| --- | --- | --- | --- | --- |
| 2026-09-03 | 0 and 1 | lint, typecheck, 505 unit tests, docs:check green | `@GG-00` 13/13 (`2026-09-03T065759052Z-407817`), `@P1-13` 4/4 (`2026-09-03T070655807Z-7bb5b1`), local stack | see git log |
| 2026-09-03 | 2 | lint, typecheck, 508 unit tests, docs:check green | `@AUDIT-LAYOUT` 25/25 (`2026-09-03T083413210Z-3c351e`), `@GG-00` 13/13 (`083918942Z-c7ed45`), `@P1-19` 8/8 (`084439990Z-4be770`), `@P1-16` 3/3 (`085243391Z-6b50bb`), `@P1-23` 4/4 (`090351380Z-7e7626`); the two audit failures and one P1-23 failure that preceded them are classified in the incident log | see git log |
