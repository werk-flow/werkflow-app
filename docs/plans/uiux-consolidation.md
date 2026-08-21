# UI/UX Consolidation — Roadmap and Ledger

Owner-directed effort (briefed 2026-08-21, canon confirmed by the owner the same day) to fix the app-wide UI/UX inconsistency **before `P1-13` starts**, and to make the resulting conventions permanently enforceable.

**Status: canon confirmed, execution in progress.** This document is the effort's living roadmap and ledger — the analogue of `phase-1-build-roadmap.md` plus the wave-audit session docs, scoped to this effort. The durable canon itself lives in the `werkflow-design` skill (`.claude/skills/werkflow-design/SKILL.md`, mirrored in `.agents/skills/`); this document holds everything a migration session needs beyond the canon: the session plan, the audited inventories, the working agreements, and the per-session ledger. When the effort closes, this file becomes a closed historical ledger (like `wave-1-audit.md`).

## How to run a session (agent protocol)

Every session in this effort follows the same protocol. Read, in order, before touching anything:

1. `AGENTS.md` (product context; loads the repo rules).
2. This document **in full** — especially your session's row in the plan, the working agreements, and the ledger entries of every completed session (they record state left behind and harness changes you inherit).
3. The `werkflow-design` skill in full. It is the canon you are migrating the app onto.
4. `docs/technical/testing.md` in full. Cite its numbered rules by number, never paraphrase from memory.
5. The primitives you will touch (read the actual component files, not just the registry table).

Working agreements:

- **Verify the starting position** first: local `main` clean at the previous session's ledger commit or a descendant; `git ls-remote origin refs/heads/main refs/heads/partner-preview` shows `partner-preview` at local HEAD or an ancestor and `origin/main` older. `origin/main` is Vercel production — **never push it**; publishing is only `git push origin main:partner-preview`.
- **The migrating session owns its harness churn.** Swapping raw selects/native inputs for registry components breaks golden/audit locators; update `tests/golden/support/steps.ts` in the same session, preferring the shared helpers (`selectFromSearchable` etc., added in S2) so future component changes touch one place.
- **Validation ladder per session** (testing.md rules by number): statics (`bunx tsc --noEmit`, lint, `bun run test:unit`) → production build on a fresh server (rules 1, 3, 7, 11) → the focused golden + focused audit specs your cluster touches (rule 9; the audit config shares the golden world artifacts, so never run golden and audit batteries concurrently) → CodeRabbit review and fixes, re-verify focused (rules 9, 10) → freeze (rule 8) → one full golden run. Success assertions read persisted state (rule 13). The final gate after M5 adds the full Wave-1 audit battery on the same frozen build, run sequentially after the full golden run.
- **Every session ends committed on local `main`** (commit messages end with the Claude Fable co-author line) **and published via `git push origin main:partner-preview`**, with this document's ledger updated in the same commit: what was migrated, what was fixed, what state/harness changes the next session inherits.
- **Deviation rule:** if a cluster genuinely needs a new interaction pattern, design it deliberately and add its registry row to the skill in the same change. Silent one-offs are the defect this effort exists to remove.
- `temporary-transcripts/` holds idea nudges, never requirements (read its README). The UI/UX transcripts were fully evaluated during canon drafting (see "Transcript evaluation" below); migration sessions do not need to re-read them. Never cite transcripts as rationale and never reference the folder from durable docs. **The folder stays after this effort** — the owner keeps it for future topic transcripts (security, infrastructure, performance).

## Confirmed canon (owner rulings, 2026-08-21)

The full canon is in the `werkflow-design` skill. The owner confirmed:

1. Uniform success banners for all explicit saves — **yes**.
2. Remove sonner toasts entirely — **yes**.
3. Undo banners are green success; blue is reserved for informational — **yes**.
4. Enter submits every non-destructive dialog form — **yes**.
5. Long-form convention: fixed-header/scroll-body/fixed-footer `DialogBody` layout with a default max-height on `DialogContent`, sectioned forms with quiet disclosure above ~8 fields, no wizards, no Sheet/page migration in this effort. Skeleton canon: three-layer coverage (route `loading.tsx`, section skeletons, org-switch overlay), spinners only for small contained actions, progress for determinate work, nothing under ~1 s — **confirmed as proposed**.
6. Session cut: S1/S2 + five migration sessions as planned below — **confirmed**, with one change: `temporary-transcripts/` is **not** deleted at the end.

## Current checkpoint

| | |
| --- | --- |
| Done | Brief + two full inventories (2026-08-21); canon proposal verified against code and confirmed by owner; **S1** (canon: skill rewrite, this roadmap, ESLint warn rules, environment doc updates) |
| Next | **S2** — primitive gap-closing |
| Then | M1 → M2 → M3 → M4 → M5 → final gate |

## Session plan

### S1 — Canon (docs + mechanics scaffolding) — **done 2026-08-21**

Skill rewritten (visual language kept; component registry, interaction canon, feedback vocabulary, loading canon, Realtime-dialog convention, extension rule, expanded shipping checklist added; the old "prefer the shadcn primitives" line replaced). This roadmap written. ESLint restrictions added at **warn** severity (escalated to error in M5): native date/time/datetime-local/number inputs, native `<select>`, sonner imports — scoped to `app/**` and `components/**`, excluding `components/ui/**`. Environments/testing docs updated for the Supabase Pro upgrade and Micro compute. Validation: statics only (docs + config).

### S2 — Primitive gap-closing

Everything migrations need, so M-sessions stay mechanical:

- `Banner` primitive + global `BannerProvider`/`useBanner()` in the app shell; `UrlFlashBanner` and `UndoBanner` wrappers. Variants success/error/info/progress; timings 3 s / 5 s-with-action / persistent for error+progress; `role="alert"`, shared in/out animation, dismiss X.
- `ErrorText` (`components/ui/error-text.tsx`), `role="alert"`.
- Generic `SelectWithCreate` (`components/ui/select-with-create.tsx`); `ClientSelectWithCreate` and `LocationSelectWithCreate` become thin wrappers over it.
- `SearchableMultiSelect` parity: `action`, `allowNone`, `readOnly`.
- `SearchableSelect`: optional `renderOption` (prepares the `JobPickerModal` reduction in M5).
- Shared de-DE search helper (`lib/ui/search.ts`, `toLocaleLowerCase('de-DE')`), used by `SearchableSelect`/`SearchableMultiSelect` and available to the dokumente dialogs.
- `QuantityStepper` promoted to `components/ui/quantity-stepper.tsx` with negative-min support (dispatch day shift); shared de-DE numeric parse/format helper consolidated with `DurationHoursInput`.
- `DialogBody` + default max-height in `components/ui/dialog.tsx` (fixed header/footer, scrollable body — generalizing the document-library move-dialog pattern).
- Realtime-suspend context: open-dialog registration in `Dialog`/`AlertDialog`/`Sheet`; `useRealtimeRouterRefresh` consumes it internally and fires one catch-up refresh on close. Existing per-dialog patch in `job-detail-content.tsx` folds into it.
- `metadata-section.tsx` select branch switches to `SearchableSelect` above ~8 options.
- Harness: add shared steps (`selectFromSearchable`, `setDatePickerValue`, `setTimeInputValue`) to `tests/golden/support/steps.ts`.

Validation: statics → focused `@GG-00` smoke → CodeRabbit → one full golden run. Expected churn: low (additive), except `metadata-section` may touch detail-page steps.

### M1 — Anfragen + Kunden

- `create-request-dialog.tsx` / `edit-request-dialog.tsx`: Zuständig raw Select → `SearchableSelect`; `datetime-local` Eingangszeit → `DatePicker`+`TimeInput`; `DialogBody` layout with section grouping (13/12 fields — worst offenders); caller block behind quiet disclosure.
- `convert-request-dialog.tsx`: native date/time inputs → registry; `DialogBody`.
- `customer-relationship-workspace.tsx`: follow-up owner select (:560), follow-up due date (:569), the two MEDIUM selects (:725, :741); max-height for follow-up/preference dialogs.
- `client-relations-section.tsx`: raw select (:803); Einsatzort/Kontakt dialogs get `DialogBody`/max-height.
- `create-client-dialog.tsx` / `edit-client-dialog.tsx`: max-height.
- `site-contact-fields.tsx` (:97, :128, MEDIUM): → `SearchableSelect`.
- Feedback: anfragen/kunden dialogs onto Banner/ErrorText matrix; keep the correct `role="alert"` habit these modules already have (now via `ErrorText`).
- Harness churn: `@GG-01`/`@P1-10` request/customer form steps.

### M2 — Auftraege + Aufgaben

- `edit-job-dialog.tsx` / `edit-project-dialog.tsx` / `create-job-form-content.tsx` / `create-project-form-content.tsx`: remove unreachable same-tick success branches (:278, :241, :644, :334) → close-then-banner convention; real forms; `DialogBody` + sections (~14 fields).
- Silent failures: `job-actions-menu.tsx:103`, `project-actions-menu.tsx:94` (status changes `console.error` only); `project-detail-content.tsx` four bare handlers (`handleDelete`/`handleOverrideStatus`/`handleJobStatusChange`/`handleClientSave` — the last closes on failure).
- `park-confirmation-dialog.tsx:108`: plain Button → `AlertDialogAction`; wording template.
- `job-qualification-section.tsx:152`: capability select → `SearchableSelect`.
- `/aufgaben`: `loading.tsx` + org-switch overlay entry; section skeletons in `aufgaben-content.tsx`.
- Harness churn: **highest** — `createJob`/`createCustomer`/assignment steps feed nearly every spec.

### M3 — Kalender + Dispatch

- `planning-entry-form.tsx`: real `<form>` (drop the forced `type="button"` at :401); native date/time (:294, :315, :362) → registry; Dauer (:316) → `DurationHoursInput`; remaining raw numbers (:319, :355, :362).
- `planning-occurrence-edit-dialog.tsx`: native inputs (:388, :401), Dauer (:416), **no max-height today** → `DialogBody`.
- `calendar-entry-dialog.tsx`: one Enter behavior and one feedback channel across all three tabs.
- `kalender/parking-context-dialog.tsx:182`: Verantwortlich → `SearchableSelect`.
- `dispatch-panel.tsx`: day-shift raw number (:941) → `QuantityStepper` (negative min); panel body text-spinner → section skeleton; same for `job-dispatch-section.tsx:248`.
- Undo banner (`day-view/undo-banner.tsx`) → `UndoBanner` wrapper (green success variant).
- Harness churn: `@P1-11`/`@P1-12`/`@GG-03` planning steps.

### M4 — Mitarbeiter + Settings + Organization

- `qualification-management-section.tsx`: selects (:259, :286), native dates (:310, :322, :344), raw number (:143), section spinner → skeleton.
- `team-management-section.tsx`: member select (:344), native dates (:374, :396), section spinner → skeleton.
- `responsibility-settings.tsx`: holder + substitute selects (:786, :801); delegation dialog max-height.
- `holiday-calendar-settings.tsx:195`: 16 Bundesländer → `SearchableSelect` (10+ rule).
- `time-tracking-settings-form.tsx`: raw numbers (:189, :219).
- `organization-switcher.tsx:60` (LOW-MED): → `SearchableSelect`.
- `work-schedule-section.tsx`, `employment-conditions-section.tsx`, `create-personnel-dialog.tsx`, `sickness-reports-section.tsx` (five dialogs): `DialogBody`/max-height.
- Settings banner provider (`settings-banner-provider.tsx`) replaced by global Banner; delete dead `settings-feedback-banner.tsx`; `role-change-banner.tsx`, dashboard `JoinedBanner`/`CreatedOrgBanner`/`OrgDeletedBanner` + onboarding duplicate, `already-member-banner.tsx` → Banner/wrappers.
- Invite cancel/delete silent failures.
- Skeletons: `/qualifikationen` (also awaits the whole profile before rendering — add Suspense), all 11 `/einstellungen/*` pages (the async settings layout blocks even sync pages), org-switch overlay entries for `/qualifikationen` and `/anfragen`.
- Harness churn: `@P1-03`–`@P1-09` settings/team/qualification steps.

### M5 — Inventar + Dokumente + Zeiterfassung/clock

- Inventar (`inventory-content.tsx`): supplier select + `NEW_SUPPLIER_VALUE` sentinel (:1288) → `SelectWithCreate`; category (:1192); movement location (:1545 — `LocationSelectWithCreate` is already imported in the file); location filter (:783, MEDIUM); real forms everywhere (the module has zero `<form>` today); ItemDialog (~20 fields) → `DialogBody` + two-column sections; silent-close mutations onto the matrix.
- `job-materials-section.tsx:991`: per-row location select.
- Dokumente (`document-library-content.tsx`): hand-styled native `<select>` (:2911); category filter (:2357, LOW-MED); `DocumentOperationBanner` (:826) → `Banner` progress variant; link/upload dialogs get container max-height; real forms.
- Zeiterfassung: `entry-history.tsx:201` employee filter → `SearchableSelect`; `manual-entry-form-content.tsx` double-error → single `ErrorText`, dialog max-height; vacation double-reporting (inline + toast) → single surface.
- `clock-fab.tsx`: `void clockOut()` (:169) discards the result — surface failure; ad-hoc red banner (:211) → Banner.
- `JobPickerModal` → shell over `SearchableSelect` (`renderOption`) on the Dialog primitive (inherits Realtime suspend).
- Remove sonner: migrate the remaining call sites (64 across 11 files at inventory time), uninstall the dependency, escalate all S1 ESLint warns to **error**.
- Harness churn: Wave-1 audit A-series (inventar/dokumente), `@P1-05`/`@GG-02` manual-entry steps.
- **Final gate:** full golden + full Wave-1 audit battery green on one frozen build (sequential, never concurrent). Then this document closes into a historical ledger.

## Audited inventories

Compiled 2026-08-21. Spot-verified against code the same day (section G) — trust but re-check line numbers, which drift as sessions land.

### A. Canonical components that already exist

| Component | Path | Features |
| --- | --- | --- |
| `SearchableSelect` | `components/ui/searchable-select.tsx` | search with clear, empty state, `allowNone`, `action` slot (inline create), `readOnly`, dialog-aware portal, full ARIA |
| `SearchableMultiSelect` | same file | search, checkbox rows, count label; **missing `action`/`allowNone`/`readOnly` parity** (closed in S2) |
| `ClientSelectWithCreate` | `components/auftraege/client-select-with-create.tsx` | wraps SearchableSelect + inline „Neuen Kunden erstellen", optimistic merge |
| `EmployeeMultiSelect` | `components/auftraege/employee-multi-select.tsx` | team-shortcut chips, qualification-date awareness, skip toasts (→ Banner in M-sessions) |
| `JobMultiSelect` | `components/auftraege/job-multi-select.tsx` | multi over jobs |
| `LocationSelectWithCreate` | `components/inventar/location-select-with-create.tsx` | inline quick-create |
| `DatePicker` | `components/ui/date-picker.tsx` | segmented keyboard entry + calendar popover |
| `TimeInput` | `components/ui/time-input.tsx` | segmented HH:MM; coarse-pointer native fallback (`time-input.tsx:210` is not a violation) |
| `DurationHoursInput` | `components/ui/duration-hours-input.tsx` | hours with ± steppers |
| `QuantityStepper` | `components/inventar/quantity-stepper.tsx` | 44px targets, de-DE decimals (→ `components/ui/` in S2) |
| `JobPickerModal` | `components/job-picker-modal.tsx` | searchable job dialog (clock-in/switch/resume) |
| `DocumentLinkDialog` | `components/dokumente/document-link-dialog.tsx` | multi-entity link manager, one search over four tabs, the repo's only `toLocaleLowerCase('de-DE')` filter |
| `AttachDocumentDialog` | `components/dokumente/attach-document-dialog.tsx` | server-side debounced search |

Adoption at inventory time: `DatePicker` 19 consumers, `TimeInput` 6, `SearchableSelect` 6, `EmployeeMultiSelect` only 3 real render sites (17 other imports are type-only), `QuantityStepper` 2 (inventar only).

### B. Component violations (complete list, assigned to sessions above)

**Raw shadcn `Select` over entity lists (unbounded, no search) — all HIGH unless noted:**
`anfragen/create-request-dialog.tsx:436` + `edit-request-dialog.tsx:341` (Zuständig), `kalender/parking-context-dialog.tsx:182` (Verantwortlich), `settings/responsibility-settings.tsx:786+801` (holder + substitute), `mitarbeiter/qualification-management-section.tsx:259+286` (employee + capability), `mitarbeiter/team-management-section.tsx:344` (member add, one per team), `zeiterfassung/entry-history.tsx:201` (employee filter), `kunden/customer-relationship-workspace.tsx:560` (follow-up owner), `inventar/inventory-content.tsx:1288` (supplier, with a `NEW_SUPPLIER_VALUE` sentinel hack that reimplements the `action` slot badly), `:1192` (category), `:1545` (movement location — while `LocationSelectWithCreate` is imported in the same file), `:783` (location filter, MEDIUM), `inventar/job-materials-section.tsx:991` (location per row), `auftraege/job-qualification-section.tsx:152` (capability), `auftraege/site-contact-fields.tsx:97+128` (site + contact, MEDIUM), `kunden/client-relations-section.tsx:803`, `kunden/customer-relationship-workspace.tsx:725+741` (MEDIUM), `settings/holiday-calendar-settings.tsx:195` (16 Bundesländer — over the 10-option line), `dokumente/document-library-content.tsx:2357` (category filter, LOW-MED), `organization/organization-switcher.tsx:60` (LOW-MED).
**Systemic lever:** `shared/metadata-section.tsx:333` renders plain selects for every inline-editable select field on every detail page — one fix (S2) propagates everywhere.

**Raw `Select` over short fixed enums:** ~40 sites (priorities, categories, reasons, types). Legitimate under the canon — do not migrate these.

**Native/hand-rolled elements:** `dokumente/document-library-content.tsx:2911` uses a hand-styled native `<select>` inside a dialog (the only one in the repo).

**Native date/time inputs where `DatePicker`/`TimeInput` exist (all HIGH):**
`anfragen/create-request-dialog.tsx:292` + `edit-request-dialog.tsx:227` (datetime-local Eingangszeit), `anfragen/convert-request-dialog.tsx:327+339`, `kalender/planning-entry-form.tsx:294+315+362`, `kalender/planning-occurrence-edit-dialog.tsx:388+401`, `kunden/customer-relationship-workspace.tsx:569` (follow-up due), `mitarbeiter/qualification-management-section.tsx:310+322+344`, `mitarbeiter/team-management-section.tsx:374+396`.

**Raw number inputs where steppers exist:** `kalender/planning-entry-form.tsx:316` + `planning-occurrence-edit-dialog.tsx:416` (Dauer in Stunden — HIGH), `planning-entry-form.tsx:319/355/362`, `kalender/dispatch-panel.tsx:941` (day shift, needs negative min), `qualification-management-section.tsx:143`, `settings/time-tracking-settings-form.tsx:189+219`.

**Near-duplicates merged in S2:** four hand-rolled search filters; `ClientSelectWithCreate` vs `LocationSelectWithCreate` (generic `SelectWithCreate`); `DurationHoursInput` vs `QuantityStepper` (shared parse/format); `JobPickerModal` duplicating SearchableSelect filter/empty/loading logic (M5, via `renderOption`).

### C. Feedback and form-UX findings (complete list)

**Ten top-center banner implementations, no shared primitive:** `settings/settings-banner-provider.tsx` (context, green/red, 3 s), `shared/feedback-banner.tsx` (prop-driven, green/red, no exit animation), `shared/action-banner.tsx` (URL-param flash, green only), `kalender/day-view/undo-banner.tsx` (**also named `ActionBanner`** — success is BLUE with an undo button, 5 s), `DocumentOperationBanner` in `document-library-content.tsx:826` (orange, spinner regardless of status, no dismiss), `mitarbeiter/role-change-banner.tsx`, dashboard `JoinedBanner`/`CreatedOrgBanner`/`OrgDeletedBanner` + `onboarding/org-deleted-banner.tsx` (identical except the export name), `dashboard/already-member-banner.tsx` (blue info), ad-hoc red banners in `clock-fab.tsx:211` and `manual-entry-form-content.tsx:362` (6–8 s, different animations). Plus dead code: `settings/settings-feedback-banner.tsx` is imported nowhere (verified). Auto-dismiss timings across all: 650/1500/3000/5000/6000/8000 ms.

**Toasts:** sonner mounted globally bottom-right; 55 `toast.error` vs 9 `toast.success` at verification time. Net effect: success is top-center green, errors bottom-right red, per module rather than intent.

**Unreachable success UI:** `edit-job-dialog.tsx:278`, `edit-project-dialog.tsx:241`, `create-job-form-content.tsx:644`, `create-project-form-content.tsx:334` set a green success message and close on the same tick — it can never render. This is why "creating a job shows nothing".

**Silent failures (defect class):** job/project status changes `console.error` only (`job-actions-menu.tsx:103`, `project-actions-menu.tsx:94`); `project-detail-content.tsx` has four handlers with no error branch (`handleDelete`/`handleOverrideStatus`/`handleJobStatusChange`/`handleClientSave` — the last also closes the dialog on failure); `clock-fab.tsx:169` discards clock-out's result entirely (`void clockOut()`); `auftraege/park-confirmation-dialog.tsx`; invite cancel/delete; most inventar mutations close silently.

**Pattern asymmetry:** every delete flow redirects to a green URL banner; almost no create/edit confirms. Vacation decisions deliberately double-report (inline + toast); `manual-entry-form-content` can show the same error twice (banner + inline).

**Inline errors:** four markups; the majority `<p className="text-sm text-destructive">` lacks `role="alert"`; anfragen/dispatch/zeiterfassung use the correct `role="alert"` variant.

**Enter-to-submit splits by module:** real `<form onSubmit>` (Enter works) in all anfragen, kunden, mitarbeiter, settings, auth, org, vacation/sickness, manual-entry dialogs; button-onClick only (Enter dead) in ALL inventar, dispatch, kalender-planung, document-link/upload, assignment dialogs — `planning-entry-form.tsx:401` even forces `type="button"`; components/inventar contains zero `<form>`/`onSubmit` (verified). Third convention: manual `onKeyDown` Enter shims in `metadata-section`, document library, checklist card. `kalender/calendar-entry-dialog.tsx` has three tabs with three different Enter behaviors and three feedback channels.

**Dialog close conventions:** silent immediate close / inline success then 1500 ms close / 650 ms auto-close / redirect — module-dependent. Destructive confirms: mostly proper `AlertDialog`+`AlertDialogAction`, but `auftraege/park-confirmation-dialog.tsx:108` uses a plain Button inside AlertDialog, dokumente uses plain dialogs with inline confirm rows, and wording/labels/titles vary freely.

### D. Realtime-suspend facts

`hooks/use-realtime-router-refresh.ts` already has the suspend mechanism: `enabled: false` blocks scheduling and an effect clears any pending timer. Exactly one consumer uses it today (`auftraege/job-detail-content.tsx:438`, `enabled: !suspendRealtimeRefresh`). S2 generalizes: open-dialog context + registration in the `Dialog`/`AlertDialog`/`Sheet` primitives + the hook consuming the context internally + one catch-up refresh on close. `JobPickerModal` is a hand-rolled `createPortal` modal and gets the behavior when it moves onto the Dialog primitive in M5. This also removes the harness's refresh-interrupted-dialog failure class at the product level (see the dedicated note in `docs/technical/testing.md`).

### E. Loading-state inventory (2026-08-21)

Layer model: (1) route `loading.tsx`, (2) in-page `<Suspense>` skeletons, (3) the app-shell org-switch overlay (`components/sidebar/app-shell.tsx` maps route prefixes to `*-page-skeleton` components; `*-content-skeleton` components serve layers 1–2). `app/(app)/layout.tsx` wraps the shell in one Suspense with `AppShellSkeleton` — that covers cold full-page loads only, not client-side navigation.

Full three-layer coverage: `/dashboard`, `/kalender`, `/zeiterfassung`, `/anfragen`(+detail, layers 1–2 only), `/auftraege`(+job/project details), `/dokumente`, `/inventar`, `/kunden`(+detail), `/mitarbeiter`(+detail). Auth/onboarding routes have parent `loading.tsx` cards.

**Gaps (assigned M2/M4):**

- `/aufgaben` — no `loading.tsx`, no overlay entry; primary nav item (M2).
- `/qualifikationen` — no `loading.tsx`, no overlay entry, page awaits a full profile fetch before rendering anything; primary nav item (M4).
- All 11 `/einstellungen/*` pages — zero coverage; the **async settings layout** blocks even the five sync pages (M4).
- Org-switch overlay map lacks `/aufgaben`, `/qualifikationen`, `/anfragen` (and skips `/einstellungen` by design — decide in M4).
- Section-level text spinners where the canon wants skeletons: `kalender/dispatch-panel.tsx:642`, `auftraege/job-dispatch-section.tsx:248` (M3), `mitarbeiter/team-management-section.tsx:488`, `mitarbeiter/qualification-management-section.tsx:649` (M4), `anfragen/request-detail-content.tsx:403` (M1).

Skeleton library: `components/loading-states/` (15 files) plus `components/ui/skeleton.tsx`, `components/sidebar/app-shell-skeleton.tsx`, and the three kalender view skeletons. Ad-hoc inline `<Skeleton>` exists in ~20 files; consolidation into `loading-states/` is per-session opportunistic, not a goal in itself.

### F. Long-form dialog inventory (2026-08-21)

Base `components/ui/dialog.tsx` `DialogContent` has **no max-height and no overflow handling** — any dialog without its own `max-h` grows past the viewport and clips unreachably (fixed in S2 with the default cap + `DialogBody`).

Three patterns in the wild: (a) `max-h-[90vh]/[92vh] overflow-y-auto` on DialogContent — the majority of long dialogs; prevents clipping but scrolls title and submit button out of view; (b) proper fixed-header/scroll-body/fixed-footer flex — only `document-library-content.tsx`'s move/copy dialog (`flex h-[min(780px,90vh)] flex-col … overflow-hidden` + `min-h-0 flex-1` body; the S2 `DialogBody` model) and partially `job-materials-section.tsx`; (c) nothing at all. No dialog uses a sticky header or footer anywhere.

Worst offenders by field count: inventar ItemDialog ~20 (`inventory-content.tsx` ~L1127, 2-column grid, pattern a), `planning-entry-form.tsx` ~17 inside `calendar-entry-dialog.tsx` (recurrence block adds ~5 conditionally), `create-request-dialog.tsx` 13, `edit-request-dialog.tsx` 12, `edit-job-dialog.tsx`/`create-job-form-content.tsx` ~14, `edit-project-dialog.tsx` 9, `work-schedule-section.tsx` ~9 (7 weekday rows, **no max-height**), `convert-request-dialog.tsx` 8 (tab switch jumps height), `planning-occurrence-edit-dialog.tsx` 8 (**no max-height**).

Long-and-unprotected (most dangerous, before field count): `planning-occurrence-edit-dialog.tsx`, `work-schedule-section.tsx`, `client-relations-section.tsx` Einsatzort (~L705), `manual-entry-dialog.tsx` (bare `DialogContent`), `sickness-reports-section.tsx` (five dialogs, none capped), `zeiterfassung/sickness-section.tsx` + `vacation-section.tsx`, `employment-conditions-section.tsx`, `create-personnel-dialog.tsx`, kunden create/edit client dialogs (textarea makes height unpredictable), `customer-relationship-workspace.tsx` follow-up/preference dialogs.

Tabs inside dialogs (no wizards exist anywhere): `calendar-entry-dialog.tsx` (Planung/Auftrag/Zeiteintrag), `create-auftrag-project-dialog.tsx` and `convert-request-dialog.tsx` (Auftrag/Projekt). `Sheet` exists but its only consumer is the auftraege mobile filter bar; there are no `/neu` full-page form routes. The `*-form-content.tsx` extractions are the ready-made seam if a future effort moves long flows out of dialogs — explicitly out of scope here.

### G. Verification notes (2026-08-21, executing session)

Twelve-plus spot checks of sections B/C against code all confirmed, including: both anfragen selects + datetime-locals, the `NEW_SUPPLIER_VALUE` sentinel, movement-location select beside the imported `LocationSelectWithCreate`, `metadata-section:333`, all four unreachable-success branches, `void clockOut()`, forced `type="button"` in `planning-entry-form:401`, dead `settings-feedback-banner.tsx`, the undo banner's `ActionBanner` name collision, the dokumente native `<select>` (:2911) and orange operation banner (:826), the park-confirmation plain Button, `entry-history:201`, the three-tab calendar dialog. Nuances found: the "byte-identical" org-deleted-banner duplicate differs in exactly one token (the export name); toast counts at verification were 55 error / 9 success (brief said ~50/8). `components/ui/form.tsx` (react-hook-form) has only 10 consumers and `field.tsx` one — the app is manual-state forms, which is why the canon mandates plain `<form onSubmit>` rather than a react-hook-form migration.

## Transcript evaluation (2026-08-21)

All 16 UI/UX transcripts in `temporary-transcripts/ui-ux-video-subs/` were read in full during canon drafting and each idea weighed against WerkFlow's calm operational language. Adopted on their own merits (now part of the canon in the skill): the four-state discipline (loading/success/error/empty) per screen and per section; skeleton-vs-spinner-vs-progress selection rules and the under-1-second no-loader threshold; error copy as what/why/next-action with no backend dumps; silent failure named as the worst error class; inline errors closest to the point of action; empty states that say what the section is for and offer the next action; success feedback calibrated to action weight; predictability over novelty for standard controls; progressive disclosure via section grouping and quiet "Weitere Angaben" collapses; independent per-section loading/failure. Deliberately rejected as consumer-app advice that does not transfer: multi-page/wizard forms for conversion (office users do routine data entry; steps add clicks), celebration/confetti empty and success states, optimistic UI as a default posture (conflicts with the persisted-state discipline of testing rule 13 and the app's correction-heavy domain), and mobile-bottom-navigation patterns (not applicable to this desktop-first manager surface; field-worker mobile ergonomics are already covered by the 44px/one-primary-action rules).

## Execution ledger

| When | Session | State |
| --- | --- | --- |
| 2026-08-21 | Brief written from the two full inventories; process docs, testing rules, and roadmap sequencing updated; effort scheduled before `P1-13` | done |
| 2026-08-21 | Canon proposal: brief verified against code (12+ spot checks, all confirmed), skeleton + long-form inventories completed (sections E/F), transcripts evaluated, owner confirmed all six rulings (transcripts folder kept) | done |
| 2026-08-21 | **S1**: skill rewritten to carry the full canon; this document restructured into the living roadmap/ledger; ESLint warn-level bans added (`eslint.config.mjs`); environments/testing docs updated for Supabase Pro + Micro compute | done |
