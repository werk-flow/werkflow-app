# UI/UX Consolidation

Owner-directed effort (2026-08-21) to fix the app-wide UI/UX inconsistency **before `P1-13` starts**, and to make the resulting conventions permanently enforceable. This document is the complete handoff brief: the audited current state, the root cause, the proposed plan, the open decisions, and the working agreements for the agents who execute it. It becomes the effort's living plan/ledger once work starts.

Status: **briefed, not started**. No canon decision below is final until the owner confirms it in the executing thread.

## Why now

Every Wave 2 slice (templates, tasks, service, time depth) is picker- and form-heavy; each one built on today's patterns would compound the mess. The 93-test golden suite plus the 74-test Wave 1 audit battery make a refactor of this size safe for the first time. And the fix is cheaper now than after fourteen more slices.

## Root cause (read this before blaming agents)

The `werkflow-design` skill (`.claude/skills/werkflow-design/SKILL.md`, mirrored in `.agents/skills/`) governs how the app **looks** — colors, radius, density — and says nothing about which component to reach for, what feedback a mutation gives, or how forms behave. Worse, it explicitly says "prefer the shadcn primitives in `components/ui/`". The custom components were never registered anywhere an agent would find them. Agents obeyed the documentation; the documentation was wrong. The durable fix is therefore documentation + mechanics, not admonition.

## Audited current state (2026-08-21, two full inventories)

### A. Canonical components that already exist

| Component | Path | Features |
| --- | --- | --- |
| `SearchableSelect` | `components/ui/searchable-select.tsx` | search with clear, empty state, `allowNone`, `action` slot (inline create), `readOnly`, dialog-aware portal, full ARIA |
| `SearchableMultiSelect` | same file | search, checkbox rows, count label; **missing `action`/`allowNone`/`readOnly` parity** |
| `ClientSelectWithCreate` | `components/auftraege/client-select-with-create.tsx` | wraps SearchableSelect + inline „Neuen Kunden erstellen", optimistic merge |
| `EmployeeMultiSelect` | `components/auftraege/employee-multi-select.tsx` | team-shortcut chips, qualification-date awareness, skip toasts |
| `JobMultiSelect` | `components/auftraege/job-multi-select.tsx` | multi over jobs |
| `LocationSelectWithCreate` | `components/inventar/location-select-with-create.tsx` | inline quick-create |
| `DatePicker` | `components/ui/date-picker.tsx` | segmented keyboard entry + calendar popover |
| `TimeInput` | `components/ui/time-input.tsx` | segmented HH:MM |
| `DurationHoursInput` | `components/ui/duration-hours-input.tsx` | hours with ± steppers |
| `QuantityStepper` | `components/inventar/quantity-stepper.tsx` | 44px targets, de-DE decimals; **invisible outside inventar** |
| `JobPickerModal` | `components/job-picker-modal.tsx` | searchable job dialog (clock-in/switch/resume) |
| `DocumentLinkDialog` | `components/dokumente/document-link-dialog.tsx` | multi-entity link manager, one search over four tabs |
| `AttachDocumentDialog` | `components/dokumente/attach-document-dialog.tsx` | server-side debounced search |

### B. Component violations (complete list)

**Raw shadcn `Select` over entity lists (unbounded, no search) — all HIGH unless noted:**
`anfragen/create-request-dialog.tsx:436` + `edit-request-dialog.tsx:341` (Zuständig), `kalender/parking-context-dialog.tsx:182` (Verantwortlich), `settings/responsibility-settings.tsx:786+801` (holder + substitute), `mitarbeiter/qualification-management-section.tsx:259+286` (employee + capability), `mitarbeiter/team-management-section.tsx:344` (member add, one per team), `zeiterfassung/entry-history.tsx:201` (employee filter), `kunden/customer-relationship-workspace.tsx:560` (follow-up owner), `inventar/inventory-content.tsx:1288` (supplier, with a `NEW_SUPPLIER_VALUE` sentinel hack that reimplements the `action` slot badly), `:1192` (category), `:1545` (movement location — while `LocationSelectWithCreate` is imported in the same file), `:783` (location filter, MEDIUM), `inventar/job-materials-section.tsx:991` (location per row), `auftraege/job-qualification-section.tsx:152` (capability), `auftraege/site-contact-fields.tsx:97+128` (site + contact, MEDIUM), `kunden/client-relations-section.tsx:803`, `kunden/customer-relationship-workspace.tsx:725+741` (MEDIUM), `settings/holiday-calendar-settings.tsx:195` (16 Bundesländer, LOW-MED), `dokumente/document-library-content.tsx:2357` (category filter, LOW-MED), `organization/organization-switcher.tsx:60` (LOW-MED).
**Systemic lever:** `shared/metadata-section.tsx:333` renders plain selects for every inline-editable select field on every detail page — one fix propagates everywhere.

**Raw `Select` over short fixed enums:** ~40 sites (priorities, categories, reasons, types). These are legitimate; the canon must say so explicitly to avoid overshooting.

**Native/hand-rolled elements:** `dokumente/document-library-content.tsx:2911` uses a hand-styled native `<select>` inside a dialog (the only one in the repo).

**Native date/time inputs where `DatePicker`/`TimeInput` exist (all HIGH):**
`anfragen/create-request-dialog.tsx:292` + `edit-request-dialog.tsx:227` (datetime-local Eingangszeit), `anfragen/convert-request-dialog.tsx:327+339`, `kalender/planning-entry-form.tsx:294+315+362`, `kalender/planning-occurrence-edit-dialog.tsx:388+401`, `kunden/customer-relationship-workspace.tsx:569` (follow-up due), `mitarbeiter/qualification-management-section.tsx:310+322+344`, `mitarbeiter/team-management-section.tsx:374+396`. (`time-input.tsx:210` is the component's own fallback, not a violation.)

**Raw number inputs where steppers exist:** `kalender/planning-entry-form.tsx:316` + `planning-occurrence-edit-dialog.tsx:416` (Dauer in Stunden — `DurationHoursInput` exists, HIGH), `planning-entry-form.tsx:319/355/362`, `kalender/dispatch-panel.tsx:941` (day shift, needs negative min), `qualification-management-section.tsx:143`, `settings/time-tracking-settings-form.tsx:189+219`.

**Adoption picture:** `DatePicker` 19 consumers (good), `TimeInput` 6, `EmployeeMultiSelect` only 3 real render sites (17 other imports are type-only!), `QuantityStepper` 2 (inventar only), `SearchableSelect` 6.

**Near-duplicates to merge:** four hand-rolled search filters (only `DocumentLinkDialog` uses `toLocaleLowerCase('de-DE')`); `ClientSelectWithCreate` vs `LocationSelectWithCreate` (a generic `SelectWithCreate` covers both plus the supplier case); `DurationHoursInput` vs `QuantityStepper`; `JobPickerModal` duplicating `SearchableSelect` filter/empty/loading logic (an optional `renderOption` on SearchableSelect would reduce it to a shell).

### C. Feedback and form-UX findings (complete list)

**Ten top-center banner implementations, no shared primitive:** `settings/settings-banner-provider.tsx` (context, green/red, 3 s), `shared/feedback-banner.tsx` (prop-driven, green/red, no exit animation), `shared/action-banner.tsx` (URL-param flash, green only), `kalender/day-view/undo-banner.tsx` (**also named `ActionBanner`** — success is BLUE with an undo button, 5 s), `DocumentOperationBanner` in `document-library-content.tsx:826` (orange, spinner regardless of status, no dismiss), `mitarbeiter/role-change-banner.tsx`, dashboard `JoinedBanner`/`CreatedOrgBanner`/`OrgDeletedBanner` + `onboarding/org-deleted-banner.tsx` (**byte-identical duplicate**), `dashboard/already-member-banner.tsx` (blue info), ad-hoc red banners in `clock-fab.tsx:211` and `manual-entry-form-content.tsx:362` (6–8 s, different animations). Plus **dead code**: `settings/settings-feedback-banner.tsx` is imported nowhere. Auto-dismiss timings across all: 650/1500/3000/5000/6000/8000 ms.

**Toasts:** sonner mounted globally bottom-right; ~50 `toast.error` vs 8 `toast.success` in 11 files. Net effect: success is top-center green, errors bottom-right red, per module rather than intent.

**Unreachable success UI:** `edit-job-dialog.tsx:278`, `edit-project-dialog.tsx:241`, `create-job-form-content.tsx:644`, `create-project-form-content.tsx:334` set a green success message and close on the same tick — it can never render. This is why "creating a job shows nothing".

**Silent failures (defect class, fix with the cluster migrations):** job/project status changes `console.error` only (`job-actions-menu.tsx:103`, `project-actions-menu.tsx:94`); `project-detail-content.tsx` has four handlers with no error branch (`handleDelete`/`handleOverrideStatus`/`handleJobStatusChange`/`handleClientSave` — the last also closes the dialog on failure); **`clock-fab.tsx:169` discards clock-out's result entirely (`void clockOut()`)**; `park-confirmation-dialog.tsx`; invite cancel/delete; most inventar mutations close silently.

**Pattern asymmetry:** every delete flow redirects to a green URL banner; almost no create/edit confirms. Vacation decisions deliberately double-report (inline + toast); `manual-entry-form-content` can show the same error twice (banner + inline).

**Inline errors:** four markups; the majority `<p className="text-sm text-destructive">` lacks `role="alert"`; anfragen/dispatch/zeiterfassung use the correct `role="alert"` variant.

**Enter-to-submit splits by module:** real `<form onSubmit>` (Enter works) in all anfragen, kunden, mitarbeiter, settings, auth, org, vacation/sickness, manual-entry dialogs; button-onClick only (Enter dead) in ALL inventar, dispatch, kalender-planung, document-link/upload, assignment dialogs — `planning-entry-form.tsx:401` even forces `type="button"`. Third convention: manual `onKeyDown` Enter shims in `metadata-section`, document library, checklist card. `kalender/calendar-entry-dialog.tsx` has three tabs with three different Enter behaviors and three feedback channels.

**Dialog close conventions:** silent immediate close / inline success then 1500 ms close / 650 ms auto-close / redirect — module-dependent. Destructive confirms: mostly proper `AlertDialog`+`AlertDialogAction`, but `park-confirmation-dialog.tsx:108` uses a plain Button inside AlertDialog, dokumente uses plain dialogs with inline confirm rows, and wording/labels/titles vary freely.

### D. Additional owner-flagged scope (not yet inventoried)

- **Loading skeletons:** several newer pages/surfaces from recent slices have none. The executing agent must inventory skeleton coverage across routes and define the canon (when a skeleton, when inline spinners, when nothing).
- **Long forms in dialogs:** today long dialogs scroll internally on short screens (see the Anfrage dialog). Decide deliberately: keep scroll-in-dialog with sticky header/footer? Multi-step? Side panel for the longest forms? Owner wants an explicit, elegant convention.
- **Inspiration transcripts:** `temporary-transcripts/` holds UX-video transcripts as idea nudges. Read them during canon drafting; adopt only what fits WerkFlow's calm operational language; never cite them as rationale; the folder stays unreferenced in durable docs (see its README).

## End-state architecture (the target, so the effort doesn't produce doc sprawl)

When this effort closes, UI/UX knowledge lives in exactly this stack, each kind in one home, and the total number of standing artifacts does NOT grow:

1. **Tokens** (`app/globals.css`) own every value. Unchanged.
2. **Primitives and registered components own behavior in code.** Wherever a convention can be encoded, encode it instead of documenting it: the one `Banner` carries the variants and timings, a dialog/form primitive carries Enter handling and the Realtime suspension, `SearchableSelect` carries empty states and search. An agent then gets the convention by using the component; deviating takes more effort than complying.
3. **The `werkflow-design` skill is the single document** — visual language (already there) + component registry + interaction canon + feedback matrix + shipping checklist. It is what every UI-touching agent loads; there is no second UI/UX doc to keep in sync. Mirrored `.claude`/`.agents` as always.
4. **AGENTS.md stays a thin pointer** to the skill (as today).
5. **Mechanical guards catch what prose can't:** the ESLint bans, CodeRabbit review context, and the slice-prompt checklist item.
6. **Leeway is a rule, not an accident:** the skill states decision rules and defaults (when raw `Select` is fine, when a banner fires), not pixel prescriptions. Feature-specific composites (like `DocumentLinkDialog`) remain welcome as compositions OF the primitives. When a genuinely new interaction pattern is needed, the rule is "design it deliberately and add a registry entry in the same change" — extension is allowed, silent one-offs are not.

This plan document itself becomes a closed historical ledger afterwards (like `wave-1-audit.md`), and `temporary-transcripts/` gets deleted. Nothing else new persists.

## Proposed plan (three steps, sessioned like the Wave 1 audit)

**Step 1 — the canon.** Draft the complete convention set and get one owner confirmation gate before touching code:
1. **Component registry** in the `werkflow-design` skill: exact import per interaction type; raw shadcn `Select` legitimate ONLY for fixed enums under ~10 options, never for entity lists (people, customers, jobs, locations, catalogs, suppliers); every list assumes 30+ entries and an empty state; registry lists the canonical empty-state and search expectations. Fix the skill's "prefer shadcn primitives" line, which caused this.
2. **Interaction canon:** every non-destructive dialog is a real `<form>` (Enter submits); destructive confirmations are `AlertDialog` + `AlertDialogAction` with a shared wording/label template, Enter never confirms destructive; one dialog-close convention; the long-form and skeleton decisions from section D.
3. **Feedback vocabulary:** ONE `Banner` primitive (top-center, shared in/out animation, dismiss X) with variants success/error/info/progress and two timings (3 s standard, 5 s with action button); undo and URL-flash banners as thin wrappers; sonner removed so feedback has one home; one `ErrorText` inline component with `role="alert"`; and a policy matrix — explicit saves/deletes confirm with a success banner, reversible direct manipulations get the banner with „Rückgängig", micro-toggles stay quiet, **every failure is visible at the point of action** (silent failure is a defect class).
4. **Realtime-vs-dialog convention** (this doubles as a harness-stability fix, see testing.md's refresh-interrupted-dialog note): every dialog suspends Realtime router refresh while open and drops pending refresh timers, via the existing `useRealtimeRouterRefresh` suspend mechanism, as a standard part of the dialog primitive rather than per-dialog patches.
5. **Mechanical enforcement:** ESLint bans on `type="date"|"time"|"datetime-local"` and raw `type="number"` in JSX outside `components/ui/`; `QuantityStepper` promoted to `components/ui/` (negative min support); registry rule wired into the slice-prompt checklist and CodeRabbit review context. The Select rule stays documentation + review (raw selects remain legitimate for enums).

**Step 2 — primitive gap-closing** (so migrations are mechanical): `SearchableMultiSelect` parity (`action`/`allowNone`/`readOnly`), generic `SelectWithCreate`, `metadata-section` branches to searchable above ~8 options, one shared de-DE search helper, stepper consolidation, the unified `Banner` primitive, `ErrorText`.

**Step 3 — migration sessions by surface cluster,** each with the full ladder (statics → focused golden+audit specs → CodeRabbit → one full golden run): suggested clusters (1) Anfragen + Kunden, (2) Kalender + Dispatch planning forms, (3) Mitarbeiter + Settings + Organization, (4) Inventar + Dokumente + Zeiterfassung/clock. Each session migrates its violations, fixes its silent-failure handlers and unreachable-success branches, applies the dialog-Realtime convention, adds missing skeletons, and updates affected harness steps. Final gate: full golden + full audit battery green on one build.

**Harness interplay (explicit working agreement):** swapping raw selects/native inputs for popover components WILL break existing golden/audit locators. The migrating session owns the corresponding `tests/golden/support/steps.ts` updates in the same session — ideally by teaching shared steps (e.g. one `selectFromSearchable` helper) so future component changes touch one place. Testing rules 12–13 and the refresh-interrupted-dialog note in `docs/technical/testing.md` are already in place and do not depend on this effort; only the app-side Realtime-dialog standardization (step 1.4) lives here.

## Open decisions for the owner (proposed defaults, confirm or override in the executing thread)

1. Uniform success banners for all explicit saves, even when the result is visible where the user lands (predictability over cleverness) — proposed: yes.
2. Remove sonner toasts entirely — proposed: yes.
3. Undo banners become green success variant; blue is reserved for informational — proposed: yes.
4. Enter submits every non-destructive dialog form — proposed: yes.
5. Long-form convention and skeleton canon — genuinely open, decide during step 1 with the transcript inspirations.
6. Session/cluster cut — proposed as above, adjustable.

## Execution ledger

| When | Step | State |
| --- | --- | --- |
| 2026-08-21 | Brief written from the two full inventories; process docs, testing rules, and roadmap sequencing updated; effort scheduled before `P1-13` | done |
