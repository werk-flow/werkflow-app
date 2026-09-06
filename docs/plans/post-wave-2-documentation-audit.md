# Post-Wave-2 documentation audit

Status: closed (2026-09-05) — documentation corrections, inspection evidence, and handoff follow-ups

The owner requested a fresh-context documentation audit after Wave 2 and the accepted UI/UX hardening pass. This record covers that audit. It does not certify the application for sensitive customer data or authorize a production release. The [roadmap](phase-1/roadmap.md) owns the current checkpoint and the [Wave 2 ledger](wave-2-audit.md) owns the remaining formal certification record.

## Coverage and method

The parent agent and three fresh review agents divided the existing documentation by ownership. The review covered the index, technical references, decisions, feature and product documents, Phase 1 protocol and gates, slice records, and historical hardening ledgers. Repository skills, `AGENTS.md`, `CLAUDE.md`, package scripts, and enforcement checks were also inspected.

Code verification followed the claims under review: authentication and organization resolution, privileged database clients, document storage and protected access, time and personnel lifecycles, maintenance scheduling, shared UI primitives, cache and Realtime ownership, test runners, preflight, fixtures, and evidence handling. This was a repository-wide documentation review with targeted implementation checks. It was not a line-by-line code audit, an execution of every flow, or a complete live infrastructure review.

Read-only Supabase inspection covered both cloud projects' catalog metadata, migration ledgers, and function definitions. No business rows were read, and no database, credential, environment, deployment, or application behavior was changed.

## Corrections

- Reconciled the accepted UI/UX checkpoint with the still-unrecorded formal Wave 2 certification gate. Historical runs remain evidence of their own build and scope.
- Removed settled decisions from feature open-question sections. Acceptance records retain their rationale, while current baselines retain delivered behavior.
- Corrected time-account carryover, maintenance creation versus scheduling, ordinary versus protected document access, inventory consumption, and OCR sequencing.
- Removed duplicate environment identities, dependency versions, pricing assumptions, enum lists, and per-slice testing and Realtime inventories where the owning document or code already supplies them.
- Corrected test artifact routing, suite ordering, review scope, closed-plan routing, and claims about build identity, fixture resets, and holiday-law detection.
- Clarified the preview publishing convention and the separate production-release authorization. Preview environment selection remains a live Vercel configuration question.
- Corrected stale skill paths, local-versus-cloud testing guidance, keyboard-confirmation wording, and unsupported unconditional schema-parity claims.

## Prevention

Tier 2 enforcement now rejects duplicate slice records even inside the canonical slice folder, unknown slice files hidden behind its index row, roadmap links to another slice's record, and an index status line that violates its own convention. Skill mirrors compare every file in both directions, including supporting scripts. Focused regression tests exercise slice-record ownership, including the `P1-00a` sub-slice.

Other corrections remove duplicated facts or route readers to the existing owner. Semantic agreement between prose and implementation still requires review; a keyword check cannot establish that a product decision remains open or that a security guarantee holds. The existing [enforcement backlog](../technical/enforcement-ladder-backlog.md) owns feasible conversions that remain open.

## Database inspection evidence

On 2026-09-05 both cloud projects reported 176 public tables, 200 public policies, 161 public functions, and 94 Realtime publication members. All public tables had RLS enabled. These counts do not prove correct authorization.

Catalog comparisons over `public` and `app_private` matched for columns, constraints, indexes, policies, non-internal triggers, and publication membership. Of 430 function definitions, three differed. `create_work_artifact_revision` differed in whitespace and `transition_time_activity` in comments. Production's `fulfill_instruction_evidence` additionally checks `FOUND` after loading the instruction item; dev lacks that guard. This is a real definition difference, not a verified exploit or a complete schema-parity certificate. Grants, Auth settings, Storage policy correctness, extension behavior, and provider configuration were not exhaustively compared.

DEV had 259 migration entries and PROD 256. The three DEV-only names are the early core-schema, role-enum, and secondary-object baseline repairs documented in [decision 0003](../decisions/0003-dev-prod-environment-split.md). Other shared names retain MCP apply-time version differences. Matching migration names or generated types does not detect a changed function body.

To repeat this comparison, use read-only catalog queries on each project: `pg_class` for public tables and RLS, `pg_policies`, `pg_proc` with `pg_get_functiondef`, `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_publication_tables`, and `supabase_migrations.schema_migrations`. Compare definitions by schema-qualified object identity and inspect differing function bodies before dismissing formatting differences. [Environments](../technical/environments.md) owns project identities and tool access.

## Follow-ups for the handoff work

These findings remain open outside this documentation pass:

| Finding | Evidence and next step |
| --- | --- |
| Function-definition drift | Reconcile `public.fulfill_instruction_evidence` through a reviewed migration and verify both cloud definitions. Determine why applied SQL diverged from the shared history. |
| Realtime DELETE guarantees | The [transport reference](../technical/realtime-and-caching.md) records a conflict between the former assurance and current provider documentation. Test cross-organization delivery and payloads on the deployed transport before claiming isolation or changing replica identity. |
| Privileged authorization freshness | `lib/jobs/auth.ts` consumes cached membership candidates; older actions also have independent gates. Audit role changes, suspended or ended access, stale sessions, and direct privileged action calls across domains. |
| Legacy member removal | `lib/members/actions.ts` still calls `remove_member_with_time_capture`; migration `20260831203000_fix_p1_21_member_removal_authorization.sql` deletes legacy `time_entries`. P1-24 controlled transitions preserve history but do not replace this separate destructive path. Assess its availability before beta use. |
| Preview and production configuration | Verify Vercel Preview branch overrides, backend and bucket targets, auth redirects, CORS, secrets, recovery, and the release/rollback procedure. A preview deployment is not proof of backend isolation. |
| Test-system guarantees | Resolve build-to-source/environment identity and concurrent battery ownership as tracked in the enforcement backlog. The Wave 2 ledger still needs its formal gate disposition. |
| Broader security, privacy, and infrastructure | Audit RLS and RPC authorization, document capabilities, public avatars, retention, backup/restore, logging, account access, and provider configuration before sensitive-data handoff. This review did not establish compliance or operational readiness. |

## Validation

Validation passed on 2026-09-05:

- `bun run docs:check`: 72 indexed documents, including this record.
- `bun test lib/docs`: five focused tests passed.
- Four temporary regression probes passed against the actual checker. The previous checker accepted each broken fixture; the updated checker rejected duplicate slice records, an extra skill script, an invalid index status, and a roadmap link to another slice's record. All temporary files were removed and modified fixtures restored.
- `bun run typecheck`, `bun run lint`, and `git diff --check` passed. Lint reported existing browser-data freshness notices and a large generated-file notice, without lint errors. The final checker and comment edits also passed scoped lint.
- A read-only scan resolved all 37 local Markdown heading-fragment links present in the documentation. The Phase 1 reviewer independently checked the 23 plan links and the Wave 2 catalog-to-ledger union of 850 flow IDs, with no missing or extra IDs.

Full browser batteries and cloud canaries were not rerun. Their existing results were inspected as historical evidence, not renewed by this audit. No commits, pushes, deployments, or backend changes were made.
