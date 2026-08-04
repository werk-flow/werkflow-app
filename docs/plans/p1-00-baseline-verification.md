# P1-00 — Baseline Verification Report

Date: 2026-08-04. This report records the discrepancy findings and resolutions required by roadmap slice `P1-00` (baseline lock). Update it if later verification invalidates a finding.

## Verified In Sync

| Check | Result |
| --- | --- |
| Generated Supabase types vs live schema | **In sync.** Freshly generated types are byte-identical to `lib/supabase/database.types.ts` (verified 2026-08-04). The earlier "stale types" claim is resolved. |
| Documentation vs implementation | Feature docs were overhauled 2026-08-04 with explicit **Current Product Baseline** sections; infrastructure state matches `docs/decisions/0001-infrastructure-stack.md` after the `P1-00a` storage migration. |

## Discrepancies Found And Resolved

| Finding | Resolution |
| --- | --- |
| Frontend Realtime provider subscribes to 27 tables, but the `supabase_realtime` publication contained only 17 — all five document tables and five inventory tables (`inventory_categories`, `inventory_suppliers`, `inventory_item_barcodes`, `inventory_import_batches`, `inventory_audit_events`) had dead subscriptions, so other users' changes did not live-refresh those surfaces | All 10 tables verified RLS-enabled, then added to the publication via migration `add_document_and_inventory_tables_to_realtime_publication`. Subscriptions and publication now match 27 = 27 |
| Org-validation triggers on `document_folders`/`documents` re-validated unchanged parent/folder links on every UPDATE, making folder-subtree soft-deletes order-dependent (user-visible delete failures) | Fixed via migrations `fix_folder_parent_validation_on_soft_delete` and `fix_document_folder_validation_on_update`; reparenting to deleted folders remains rejected (rollback-tested) |
| No Vercel region was declared anywhere, so Functions could run far from the Supabase EU database | `vercel.json` now pins `regions: ["fra1"]` (Frankfurt). Verify on the next deployment (see below) |

## Open Items (P1-00 not complete until resolved)

1. **Automated regression coverage does not exist.** The repo has no test runner or test script. Establishing the core smoke suite promised by `P1-00` is still open; at minimum the `GG-00` scenarios should be scripted or a documented manual checklist run per release.
2. **`GG-00` manual gate run pending.** Requires owner-run multi-role verification (admin/Büro/employee accounts): onboarding/invites, customer→job→schedule→assignment flow, employee-scoped visibility, time tracking, contextual documents (now on R2), inventory take/return, organization isolation, sign-out, Realtime freshness (including the newly published document/inventory tables), responsive paths. Partial evidence exists: owner verified document upload/view/download on a production build 2026-08-04.
3. **Frankfurt region verification after next deploy**: in Vercel → Project → Deployments → latest → a Function's details should show `fra1`; or Project → Settings → Functions should reflect the `vercel.json` value.
