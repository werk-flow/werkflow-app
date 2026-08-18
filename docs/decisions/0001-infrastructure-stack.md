# 0001 — Infrastructure Stack For Phase 1 And Beyond

- **Status:** Accepted
- **Date:** 2026-08-04
- **Update 2026-08-18:** the shared dev/test/prod Supabase project follow-up is resolved — development and testing moved to a dedicated dev project; see [0003](0003-dev-prod-environment-split.md).
- **Owner:** Product owner (Tamay), evaluated with agent research across database, auth, storage, and deployment
- **Affects:** Every feature area; see the relevance map below

## Decision Summary

| Area | Decision | Change required? |
| --- | --- | --- |
| Database | Keep Supabase-managed **Postgres** (EU) as the operational source of truth | No migration; hygiene only |
| Authorization model | App-layer checks in server code remain primary; **RLS stays as a safety net**, not the sole authorization system | Ongoing discipline, no rework |
| Auth | Keep **Supabase Auth** | None now; re-evaluate before mobile app and external identities |
| Realtime | Keep **Supabase Realtime** | Reconcile subscriptions vs. published tables in `P1-00` |
| Web deployment | Keep **Vercel** for the Next.js app | Verify/pin Functions region to Frankfurt (`fra1`) near the database |
| Active file storage | Migrate file bytes from Supabase Storage to **Cloudflare R2 (EU jurisdiction)** with **direct browser uploads/downloads via short-lived signed URLs** | Yes — roadmap slice `P1-00a`, before feature build-out |
| Legal retention archive | Separate, independently administered **S3 bucket with Object Lock (compliance mode)** for retention-relevant document categories | Design during Wave 4/5 (`P1-45`), not needed on day one |
| Background workers | **Railway**, added only when the first real long-running workload exists (expected around OCR/import work, `P1-44`/`P1-47`) | Nothing now |
| Phase 2 AI hosting | External model provider APIs (Anthropic / OpenAI / OpenRouter). **No self-hosted models, no GPU infrastructure** | None; do not factor hypothetical model hosting into infra choices |

## Context

Before Phase 1 feature build-out, we evaluated replacing Supabase with Convex, Vercel with Railway, and Supabase Auth with WorkOS/Clerk/Better Auth/Convex Auth. Inputs: the extended Phase 1/Phase 2 scope in `docs/product/product-capability-map.md` and `docs/plans/phase-1-build-roadmap.md`, live Supabase state (~30 tables, ~56 RLS policies, 17 Realtime tables, 100+ coupled source files), two video transcripts on Convex and deployment options, and independent verification of current provider pricing.

## Rationale

### Database: Postgres (via Supabase)

Phase 1 is an ERP-shaped workload: invoices with controlled number ranges, immutable issued documents, period close, payroll-ready exports, post-calculation reports, inventory valuation, audit trails, and cross-domain reporting. These depend on exactly what a relational database provides declaratively — foreign keys, uniqueness constraints, transactions, joins, aggregation, window functions — and what document-style databases (Convex) require hand-written application code or precomputed aggregates to approximate.

Choosing Supabase here is really choosing **Postgres**; Supabase is a managed-Postgres vendor plus bundled auth/realtime/storage. Plain Postgres is fully portable: if Supabase ever becomes a problem, the database can move to another Postgres host (RDS, Neon, PlanetScale for Postgres, self-managed) without a data-model rewrite. That portability was a deciding factor.

Common Supabase criticism ("RLS is sketchy", "not for serious apps") targets a usage pattern WerkFlow does not follow: querying the database directly from the browser with RLS as the *only* authorization layer. WerkFlow authorizes in server code (Server Actions validating the user and organization first) and uses RLS as defense in depth. That pattern is standard multi-tenant practice.

A wholesale migration was rejected because it would burn weeks rebuilding organization isolation, invariants, atomic inventory movements, triggers, auth flows, and reporting that already work — before delivering any new feature — and the roadmap is at 0 of its slices.

**Rejected: Convex.** Genuinely strong for reactive, TypeScript-native, agent-friendly app development, and its "schema and access rules live in the codebase" model is a real advantage. But it has no SQL join/aggregation language, acknowledges weakness in analytical workloads, and would force hand-rolled implementations of relational guarantees the commercial/finance scope needs. Its advantages solve problems WerkFlow does not have (greenfield reactive apps); its costs land exactly where WerkFlow's hardest requirements are (reporting, constraints, migration).

**Rejected: PlanetScale (or another bare database host).** Excellent managed database, but database-only: auth, realtime, and storage integration would need to be assembled separately for no current benefit. Its sharding/scale strengths solve problems far beyond WerkFlow's realistic scale. Remains a valid future Postgres destination thanks to Postgres portability.

### Auth: Supabase Auth (for now)

Working and integrated today; migrating auth and evaluating databases simultaneously is unnecessary risk. Auth **must not be deferred indefinitely**: Phase 1 adds invitations, offboarding, mobile sessions, and service identities. Re-evaluate (WorkOS AuthKit and Clerk are the leading managed candidates; Better Auth if EU self-hosting outweighs operational simplicity) when the React Native app or external/enterprise identity becomes concrete. Convex Auth was rejected as beta/not production-ready.

Standing rule regardless of provider: **authentication and authorization stay separate.** The provider proves identity; WerkFlow owns organizations, roles, capabilities, offboarding, and audit attribution. Never make an external provider's user ID the primary key of operational records; map external identities through a stable internal principal.

### Active file storage: Cloudflare R2 (EU), direct uploads

Two independent reasons force this change before feature build-out:

1. **Correctness:** the app advertises 50 MB uploads buffered through Server Actions (`next.config.ts` `bodySizeLimit: "50mb"`), but Vercel Functions enforce a hard ~4.5 MB request-body limit in production. Large uploads fail on the deployed app today regardless of configuration.
2. **Economics:** SHK businesses will store and re-download large document/photo volumes for many years. Egress ("data leaving the provider") is the dominant long-term cost. R2 storage is $0.015/GB-month with **$0 internet egress**; Supabase Storage charges egress beyond plan allowances. At the terabyte scale we expect, R2 is the cheapest reliable option and removes download volume from the bill permanently.

Target flow (applies to every feature that touches files):

1. Server code authorizes the request (user, organization, permission).
2. Server issues an immutable object key and a short-lived signed upload URL.
3. Browser uploads bytes **directly to R2** — bytes never pass through Vercel, Supabase, or workers.
4. Browser reports completion; server validates and records metadata (Postgres remains the metadata source of truth: links, categories, versions, trash, audit).
5. Downloads use the same authorize-then-signed-URL pattern.

The storage interface must stay provider-neutral (S3-compatible API) so buckets can move without touching feature code.

### Legal retention archive: separate S3 bucket with Object Lock

R2 alone is not a compliance archive (no Object Lock/legal-hold API, no native versioning; an administrator can remove protection). For retention-relevant categories, copy issued/received records to a second, independently administered S3 bucket using **Object Lock compliance mode** (even the account root cannot delete during retention).

German retention is per document category, not a blanket 10 years: books/financial statements commonly 10 years (AO §147, HGB §257), accounting vouchers commonly 8, commercial correspondence commonly 6, extended by open proceedings. Retention policy therefore needs document-category awareness, legal holds, checksums, and restore testing — and **infrastructure alone never makes the system GoBD-compliant**; qualified German tax/legal review is required before any compliance claim.

### Deployment: Vercel now, Railway when workers exist

Vercel remains the simplest, best-supported host for the Next.js 16 / Cache Components stack, and its cost risk (bandwidth-heavy assets on its CDN) disappears once file bytes go directly to R2. Action item: verify and pin the Functions region to Frankfurt (`fra1`) next to the Supabase EU database.

Railway is the chosen home for future long-running or persistent workloads that don't fit serverless: OCR/PDF processing, large imports/exports, queue consumers, connector sync. Add it when the first such workload lands (expected around `P1-44`/`P1-47`), not before. Railway as a wholesale Vercel/Supabase replacement was rejected: it would recreate the file-economics problem R2 already solves and make WerkFlow responsible for assembling auth/RLS/realtime/storage around a bare Postgres container.

### Phase 2 AI: provider APIs only

Phase 2 assistants/automations call hosted model APIs (Anthropic, OpenAI, optionally OpenRouter as a router) with server-side keys. Models run on provider infrastructure; WerkFlow owns workflow state, approvals, budgets, provenance, and audit. What Phase 2 needs from infrastructure is durable queues, idempotency, retries, approval checkpoints, per-organization cost limits — all buildable on Postgres plus a Railway worker. Self-hosting open-weight models would use a dedicated GPU/inference provider **and is explicitly not a factor in today's database/deployment choices**.

## Feature Relevance Map

Which infrastructure areas matter to which feature work:

| Feature area | Database | Auth | File storage (R2) | Archive (Object Lock) | Workers (Railway) |
| --- | --- | --- | --- | --- | --- |
| Customers/CRM | Core tables, RLS | — | Request attachments (`P1-02`) | — | — |
| Jobs/projects | Core tables, atomic state | — | Photos, reports, signatures (`P1-15`–`P1-17`) | — | — |
| Service/maintenance | Equipment history | — | Visit reports, manuals | — | — |
| Calendar/planning | Realtime freshness | — | — | — | Route/feasibility later |
| Employees | Role/permission source | Invitations, offboarding, sessions | Personnel documents (`P1-24`, restricted access) | Personnel retention rules | — |
| Time tracking | Period close, exports | Mobile sessions later | Generated time evidence | Export retention | — |
| Documents | Metadata source of truth | — | **Primary consumer** — all bytes on R2 (`P1-00a`) | Retention-relevant categories (`P1-45`) | OCR/thumbnails/full-text (`P1-44`) |
| Inventory/procurement | Atomic movements, valuation | — | Delivery notes, supplier documents | Voucher retention | Wholesaler standard sync (`P1-34`/`P1-50`) |
| Commercial/finance | Number ranges, immutability, reporting | — | Issued PDFs, e-invoice files | **Primary consumer** — issued invoices etc. | Bank import, export generation |
| AI automations | Events/actions/audit tables | Service identities | Source file access via signed URLs | — | **Primary consumer** — agent/workflow runtime |
| Mobile app (future) | Same backend | Session/token model decision | Same signed-URL pattern | — | — |

## Sequencing (What Changes When)

1. **`P1-00` (baseline lock):** regenerate stale Supabase types; reconcile Realtime subscriptions vs. published tables; verify Vercel Frankfurt region.
2. **`P1-00a` (new slice, before file-touching feature slices):** provider-neutral storage interface; R2 EU bucket; direct signed uploads/downloads; migrate existing objects (~small volume today); checksums, immutable keys, orphan reconciliation; remove the Server-Action byte-buffering path and its 4.5 MB production failure.
3. **Wave 1–3:** no infrastructure changes; all file features build on the `P1-00a` interface.
4. **Wave 4/5 (`P1-45` window):** design and stand up the independent retention archive with per-category policies; qualified legal review before any compliance wording.
5. **First worker workload (`P1-44`/`P1-47` or earlier if needed):** add Railway (worker + queue), keeping file bytes on the direct-to-R2 path.
6. **Before mobile app / external identities:** auth re-evaluation decision record.
7. **Phase 2 start:** provider API keys, budgets, and audit plumbing per `docs/features/ai-automations.md`; no new hosting class.

## Cost Model Snapshot (2026-08, USD, pre-VAT — refresh before pricing decisions)

Fixed platform costs (shared across all customers): Vercel Pro ~$20/seat/month; Supabase Pro from $25/month plus compute size as load grows; Railway ~$20–60/month once workers exist. Roughly **$65–130/month total** at early scale.

Marginal cost per onboarded business is dominated by file storage. At an assumed 2 TB active files per business: R2 ~$30/month (egress $0), archive copy a few dollars at most (subset of documents, cold storage class), database/auth/bandwidth marginal cost near zero at 25-employee scale. **≈$30–35/month per 2 TB business.** Storage allowance must therefore be part of packaging (`docs/product/offer.md`); the 2 TB assumption itself is unvalidated — original-resolution photos/videos, not PDFs, will drive it, so measure real usage during onboarding.

Reference prices verified 2026-08: R2 $0.015/GB-month, free egress; Supabase Pro includes 100k MAU; Convex file egress now $0.12/GB (the "$0.30" figure circulating in videos is outdated); Railway $10/GB-RAM-month, $20/vCPU-month, $0.05/GB service egress.

## Revisit Triggers

Reopen this decision if any of the following occurs:

- Supabase pricing, reliability, or EU posture changes materially.
- Postgres compute cost or performance becomes a measured problem (first stop: bigger instance or read replica, not a platform change).
- The React Native app's session model doesn't fit Supabase Auth well (auth section only).
- A workload appears that Vercel Functions genuinely cannot serve (move that workload to Railway; do not move the app reflexively).
- Cloudflare changes R2's free-egress policy (storage is S3-compatible and portable by design).

## Related Docs

- [Phase 1 build roadmap](../plans/phase-1-build-roadmap.md) — slice `P1-00a` and sequencing
- [Technical architecture](../technical/architecture.md)
- [Document management](../features/document-management.md) — storage model
- [Commercial and finance](../features/commercial-and-finance.md) — retention and audit
- [AI automations](../features/ai-automations.md) — Phase 2 hosting boundary
- [Product offer](../product/offer.md) — storage allowance packaging
