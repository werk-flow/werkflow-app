# P1-00 — Baseline lock

Status: closed (2026-08-04) — accepted P1-00 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Lock the documentation baseline, verify every current feature baseline against code/generated types/live Supabase, establish regression coverage, and record the first accepted implementation checkpoint. Includes the infrastructure hygiene items from [decision 0001](../../../decisions/0001-infrastructure-stack.md): regenerate stale Supabase types, reconcile Realtime subscriptions with published tables, verify/pin the Vercel Frankfurt region

## Direct dependencies

None

## Primary and connected specs

All feature specs; technical architecture/data model

## Acceptance evidence

Findings and resolutions in the [baseline verification report below](#baseline-verification-report-merged-2026-09-03-from-the-former-separate-report-file): types verified in sync; 10 missing Realtime publication tables added; Vercel region pinned to `fra1` via `vercel.json`. Regression coverage exists: `GG-00` automated v3 passes 13/13 on a fresh production build (2026-08-04), covering the complete baseline scenario including invites/onboarding and inventory take/return. **Accepted `complete` 2026-08-04**: owner confirmed Frankfurt (`fra1`) on the latest deployment

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)

## Baseline verification report (merged 2026-09-03 from the former separate report file)

Date: 2026-08-04. This report records the discrepancy findings and resolutions required by roadmap slice `P1-00` (baseline lock).

### Verified in sync

| Check | Result |
| --- | --- |
| Generated Supabase types vs live schema | **Now in sync.** The previously committed types were genuinely stale (missing `email_change_challenges` and ~800 lines of newer schema). The regenerated file was committed 2026-08-04 (`b956ab6`) and verified byte-identical to a fresh generation from the live schema; the app typechecks against it. |
| Documentation vs implementation | Feature docs were overhauled 2026-08-04 with explicit **Current Product Baseline** sections; infrastructure state matches [0001-infrastructure-stack.md](../../../decisions/0001-infrastructure-stack.md) after the `P1-00a` storage migration. |

### Discrepancies found and resolved

| Finding | Resolution |
| --- | --- |
| Frontend Realtime provider subscribes to 27 tables, but the `supabase_realtime` publication contained only 17 — all five document tables and five inventory tables (`inventory_categories`, `inventory_suppliers`, `inventory_item_barcodes`, `inventory_import_batches`, `inventory_audit_events`) had dead subscriptions, so other users' changes did not live-refresh those surfaces | All 10 tables verified RLS-enabled, then added to the publication via migration `add_document_and_inventory_tables_to_realtime_publication`. Subscriptions and publication now match 27 = 27 |
| Org-validation triggers on `document_folders`/`documents` re-validated unchanged parent/folder links on every UPDATE, making folder-subtree soft-deletes order-dependent (user-visible delete failures) | Fixed via migrations `fix_folder_parent_validation_on_soft_delete` and `fix_document_folder_validation_on_update`; reparenting to deleted folders remains rejected (rollback-tested) |
| No Vercel region was declared anywhere, so Functions could run far from the Supabase EU database | `vercel.json` now pins `regions: ["fra1"]` (Frankfurt). Verify on the next deployment (see below) |

### Open items at the time (all resolved 2026-08-04)

1. ~~Automated regression coverage does not exist.~~ **Resolved 2026-08-04:** the Playwright golden-gate harness exists ([testing.md](../../../technical/testing.md)) and `GG-00` automated v1 passes 8/8 against a disposable multi-role organization, including a 6 MB direct-to-R2 upload and cross-organization isolation. Run log: [golden-gate-log.md](../../golden-gate-log.md).
2. ~~**`GG-00` coverage gaps.**~~ **Resolved 2026-08-04:** automated v3 (13/13 passing on a fresh production build) adds the two remaining flows — invite/onboarding (real invite dialog, real email via Resend test address, real link/login redemption, role-appropriate surfaces) and employee inventory take/return on an assigned job with stock-ledger consistency assertions. The gate now covers the roadmap's full `GG-00` scenario. The v3 cycle found and fixed another real defect: `ClockStateProvider` let a late-streamed server snapshot overwrite a newer client mutation, visually reverting a successful clock-in. Earlier v2 findings: missing Realtime refresh on `/kunden`, and a pre-hydration login fallback that put credentials into the URL.
3. ~~**Frankfurt region verification after next deploy**~~ **Resolved 2026-08-04:** the product owner confirmed the latest Vercel deployment's Functions show `fra1`, and upload/download works on the deployed app (first production deploy on the R2 storage path).
