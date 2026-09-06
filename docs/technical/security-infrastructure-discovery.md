# Security and infrastructure discovery

Status: closed (2026-09-06) — dated pre-audit evidence snapshot, not a completed security audit

## How to use this snapshot

The [Step 1 security and infrastructure plan](../plans/security-infrastructure-hardening-2026-09.md) now owns current findings, investigation, remediation, and acceptance evidence. Read this snapshot to understand the starting observations and their limits, then verify current code and provider state through that plan.

Keep this file after the hardening pass as dated evidence. Do not update its observations to describe later fixes or maintain a second backlog here. If an original statement proves inaccurate, add a dated correction that explains the error. Adopted controls belong in the owning technical/feature docs and enforced implementation; the execution plan links to them when it closes.

## Scope of this record

This record gathered source-supported findings and unresolved deployment questions before the owner commissioned the security and infrastructure hardening plan. No security repair, dependency upgrade, provider mutation, penetration test, or production release is recorded here. Findings distinguish existing backlog items from additional observations. Do not infer deployed exploitability from a source pattern or dependency advisory alone.

The reviewed checkpoint includes commit `843d773`, followed by the phone-layout and test-server review corrections. Inspection covered the six `app/api` route handlers, authentication callback and proxy, shared identity and membership readers, selected privileged time and personnel paths, document upload authorization and finalization, dependency declarations, Next/Vercel configuration, and prior infrastructure evidence. This is targeted inspection, not review of every action, policy, function, or infrastructure setting.

The [documentation audit](../plans/post-wave-2-documentation-audit.md) owns the September 5 cloud catalog comparison and its limits. The [enforcement backlog](enforcement-ladder-backlog.md) owns existing conversions. [Environments](environments.md) owns backend identities and access methods. These records must be reconciled with current source and live configuration during the eventual audit.

## Source findings

| Observation | Evidence and qualification |
| --- | --- |
| Known unauthenticated privileged profile read | `app/api/get-profiles/route.ts` accepts user IDs and returns profile names through the service-role client without authentication or organization checks. `/api` is outside `proxy.ts`'s matcher. No current application caller was found. An unused route remains deployable. A caller needs valid IDs; UUID discovery and deployed access were not tested. This reconfirms the existing legacy-route backlog item. |
| Known cross-organization change-request concern | `lib/time-tracking/actions.ts`, `getChangeRequestsForEntries`, validates UUID-shaped IDs and authenticates the caller, then selects pending `entry_change_requests` through the privileged client by entry IDs without an organization or visibility predicate. The public wrapper delegates to that action. Authentication alone does not establish permission to read each supplied entry. No foreign records were requested. |
| Additional unsafe redirect construction | `app/auth/callback/route.ts` concatenates request origin and unvalidated `next` in successful non-recovery auth branches. A local URL-parser check establishes that a value starting with `@` can change the parsed destination origin. Recovery has a fixed destination. Controlled auth-flow verification and cookie behavior remain untested; no account compromise is claimed. |
| Additional unauthenticated invalidation action | `lib/auth/actions.ts` exposes `invalidateProfileCache(userId)` as a Server Action without authenticating or authorizing the supplied identity. This is an abuse/integrity lead, not evidence of profile disclosure. |
| Known authorization freshness concern | `lib/jobs/auth.ts` uses `getCachedMemberships` for privileged role decisions. `lib/data/cached.ts` caches membership candidates across requests, while lifecycle scheduling is evaluated against the current time. That current-time filter does not itself prove immediate recognition of role changes or newly stored access blockers. Mutation invalidation and independent RPC checks require examination together. |
| Known destructive legacy removal path | `lib/members/actions.ts` still calls `remove_member_with_time_capture`. The existing documentation audit identifies legacy time-entry deletion in its migration. Its continued reachability and relationship to P1-24's history-preserving lifecycle remain unresolved. |
| Error disclosure and organization-cookie leads | `app/api/redeem-invite/route.ts` returns unknown database error messages and deliberately reports the invited email on a mismatch. Authentication and possession of an invitation limit that path; intended disclosure needs review. `app/api/set-org-cookie/route.ts` accepts an unverified string, but downstream membership checks prevent treating that fact alone as tenant-data access. |

## Existing protections that the audit must account for

- `lib/supabase/admin.ts` has a server-only import boundary. That prevents client bundling; callers still need their own authorization.
- `getAuthenticatedUser` validates identity with Supabase `getUser` and deduplicates within a request. Cookie-presence checks in the proxy are not the authoritative permission boundary.
- The time-entry route and organization-member route have authentication and visibility checks. Do not label every legacy endpoint unauthenticated because one endpoint is.
- Ordinary document upload tickets authorize their target and generate server-owned paths. Finalization reauthorizes, recomputes the path, and checks stored object size and existence. Protected personnel documents have separate access rules and cleanup capabilities. Direct uploads, expired capabilities, retained objects, downloads after revocation, and public avatars still require dedicated review.
- Realtime events trigger authoritative reads. Central subscriptions, generation guards, and editor suspension protect consistency. The previously recorded DELETE payload/isolation question is still unresolved.
- The repository separates local application tests from cloud DEV canaries and production. This is a source convention; actual Vercel Preview branch overrides, credentials, and bucket routing were not inspected in this session.

## Read-only cloud evidence, September 6

Security advisers and narrowly scoped function-catalog queries ran against both DEV and production. No business records were requested and no provider state changed. Both projects reported healthy status in Frankfurt, with different Postgres patch versions. This is not a complete provider configuration or database audit.

Both advisers returned the same three observations: RLS enabled without policies on `public.personnel_lifecycle_operations`, and anonymous plus authenticated execution grants on the security-definer function `public.set_job_assignment_organization()`. The policy-free table may intentionally deny direct access to an internal lifecycle ledger. The catalog confirms that the function returns `trigger`; the adviser wording alone does not establish an exploitable callable RPC. Its settings include `search_path=public`, and its grants include PUBLIC, anonymous, authenticated, and service-role execution. Inspect its trigger attachment, write permissions, and object resolution before choosing a correction.

`fulfill_instruction_evidence` remains different between DEV and production: its catalog definition hashes differ. Both copies are security-definer functions with an empty search path and execution restricted to Postgres and the service role. This reconfirms the earlier drift without establishing which function body is correct. Reconcile the actual definitions and committed migration before changing either backend.

## Dependency evidence

`bun audit --json` returned advisories for 14 package names on September 6, including 31 advisory entries for the installed Next.js dependency. Entries can overlap, include development tooling, and depend on configurations the app does not use. They are not 31 demonstrated application vulnerabilities. The raw result is retained locally in `.agent-logs/security-dependency-audit.json`; rerun the command when assessing the eventual repair candidate.

`package.json` pins Next.js `16.0.10`, and `next.config.ts` enables Cache Components. The maintainer's [Cache Components connection-exhaustion advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mg66-mrh9-m8jx) includes this version and feature combination. The [Server Actions denial-of-service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj) also warrants applicability review. These establish priority for dependency triage; deployed provider mitigations and exact request reachability were not verified. Do not select an upgrade solely from one advisory's first patched version because later advisories can require a newer release.

No package or lockfile changed during discovery. Separate shipped runtime dependencies from development-only transitive dependencies when assessing exposure and choosing checks.

## Infrastructure and operational evidence still missing

| Boundary | What is not established yet |
| --- | --- |
| Public entry points and abuse | Complete inventory of Server Actions, route handlers, RPC grants, edge functions, auth endpoints, signed-upload capability issuance, request/body limits, and shared rate-limit enforcement. No application rate-limiter was found in the inspected paths; provider auth limits and deployed WAF controls were not inspected. |
| Organization, role, and access lifecycle | Denial across tenants and all roles, object-specific authorization, suspended/ended/prestart accounts, stale sessions, role changes, bulk IDs, and current responsibility delegation. RLS enabled on every table does not prove its policies or privileged bypass callers are correct. |
| Schema and provider parity | Current function bodies, grants, privileged functions/search paths, RLS policies, publication payloads, Auth configuration, and deployed edge-function parity. The prior `fulfill_instruction_evidence` definition difference needs reconciliation with live state. |
| Storage | Private/public bucket settings, CORS, URL expiry/reuse, signed upload limits, unsafe file rendering, metadata versus actual file content, malware handling, orphan cleanup, deletion/version retention, and data access after role changes. |
| Hosting and delivery | Preview/production secrets and backend targets, deployment protection, branch controls, environment-specific auth redirects, security headers/CSP, TLS, cache isolation, runtime regions, build provenance, rollback and migration compatibility. `vercel.json` declares Frankfurt and frozen Bun installation; that does not prove the dashboard configuration. |
| Recovery and operations | Database and file-byte backups, tested coordinated restore, recovery objectives, deletion protection, monitoring, redacted alerts, incident handling, provider outages, cost limits, service-account ownership, and access recovery. No restore exercise or provider configuration inspection occurred here. |
| Sensitive data and privacy | Inventory and purposes for customer, personnel, sickness, time, documents, logs, traces, exports and backups; retention/deletion versus business record preservation; provider/subprocessor agreements and region commitments. Legal conclusions need appropriate primary-source and professional review. |
| Agent and supply-chain access | Repository/history secret scanning, least-privilege agent/provider credentials, review-tool data handling, dependency advisories and provenance, untrusted external instructions, generated artifacts, and CI/deployment access. The staged credential-pattern check is not a complete secret/history audit. |

## External review capability

[CodeRabbit guidance](coderabbit.md#dedicated-security-scanning-checked-2026-09-06) records the dedicated product's documented interface, billing, coverage limits, and unverified account entitlement. It is supplementary evidence. Neither ordinary CodeRabbit review nor a dedicated scan establishes live database authorization, infrastructure configuration, or operational readiness.

## Handoff boundary

The implementation agent must separate confirmed defects, hypotheses, existing safeguards, and missing evidence in the execution plan. This snapshot does not choose remediation architecture, order implementation steps, waive acceptance, or authorize a production mutation. When a correction is adopted, its owning feature/technical documentation and the enforcement tiers must describe the actual invariant and proof.
