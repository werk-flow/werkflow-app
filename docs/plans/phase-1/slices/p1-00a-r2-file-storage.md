# P1-00a — R2 file storage

Status: complete (accepted 2026-08-04)

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Migrate file bytes to Cloudflare R2 (EU) behind a provider-neutral storage interface with direct signed uploads/downloads, fixing the current production failure where Server-Action-buffered uploads exceed Vercel's ~4.5 MB body limit. Migrate existing objects, keep Postgres as the metadata source of truth

## Direct dependencies

`P1-00`

## Primary and connected specs

Document management; technical architecture; [decision 0001](../../../decisions/0001-infrastructure-stack.md)

## Acceptance evidence

Implemented 2026-08-04 (ahead of `P1-00` by product-owner instruction): `lib/storage/r2.ts`, ticket+finalize upload actions, R2 signed download URLs, objects migrated into both buckets and verified, presigned round trips pass with pinned content types, CodeRabbit review findings fixed, owner verified upload/download on a production build, both buckets have CORS. Folder-tree soft-delete surfaced an order-dependent org-validation trigger bug; fixed via migrations `fix_folder_parent_validation_on_soft_delete` and `fix_document_folder_validation_on_update`. Because dev and prod shared one Supabase database at the time, both environments used `werkflow-documents-prod`. Local `R2_BUCKET_NAME`/CORS unification was done in practice (`GG-00` v2/v3 uploads ran against `werkflow-documents-prod` from `http://localhost:3000`), and the `GG-00` file paths were rerun (v3, 13/13). *(Superseded 2026-08-18: environments split per decision 0003 — local dev and tests now use `werkflow-documents-dev`.)* **Accepted `complete` 2026-08-04**: owner verified upload/download on the first Vercel production deploy over the R2 storage path. Direct prerequisite for every later slice that uploads or serves files (first: `P1-02`)

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
