# Technical-term transcript considerations

Reviewed on 2026-09-06 for security and infrastructure fact gathering, with later performance topics retained. Statuses follow [README.md](README.md). Analogies are considered as explanations, not proof of implementation. Follow/comment requests and generic claims that one prompt fixes an entire app do not authorize work. Several videos refer to screen-only examples absent from the transcript; those omissions remain explicit.

## TERM-001

Source: [CORS](vibecoder-terms-video-subs/2026-06-24-EP-01-cors.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | browser-security | Candidate | Inspect which browser origins may read responses; the guest-list analogy does not imply server authentication. |
| 02 | browser-security | Verify | A CORS failure may involve proxy, request mode, or unsupported credentials, not always a backend code edit. Change only the actual allowed-origin configuration. |

## TERM-002

Source: [Environment variables](vibecoder-terms-video-subs/2026-06-25-EP-02-environment-variables.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | secrets | Candidate | Separate server credentials from intentionally public configuration and inspect actual compiled output. |
| 02 | secrets | Verify | Environment variables are not all secrets; .env files and public prefixes do not themselves establish secrecy. Verify Next.js naming/build behavior. |
| 03 | secrets | Candidate | Exposure of database/service credentials may allow direct access beyond the app's own checks; scope and rotate verified exposed secrets. |

## TERM-003

Source: [Idempotency](vibecoder-terms-video-subs/2026-06-26-EP-03-idempotency.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | business-integrity | Candidate | Use the duplicate checkout example to inspect duplicate mutations and their real effects. |
| 02 | business-integrity | Candidate | Bind stable intent identity across the operation lifecycle and handle concurrent attempts atomically. |
| 03 | api-contracts | Verify | Returning an earlier result and rejecting a duplicate are distinct contracts. A blanket UUID/header on every POST is not sufficient or always necessary. |

## TERM-004

Source: [Race conditions](vibecoder-terms-video-subs/2026-06-27-EP-04-race-conditions.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | business-integrity | Candidate | The two withdrawals illustrate lost updates; inspect stock, time, approval, and lifecycle operations for equivalent concurrent invariants. |
| 02 | database-security | Verify | Transactions alone do not guarantee that invariant under every isolation level. Inspect locking, conditional updates, constraints, and conflict handling. |
| 03 | performance | Deferred | Reconsidered 2026-09-12. Preserve existing transaction integrity. No global application lock was introduced for this pass. Investigate narrower locks if measured concurrent business transactions show contention; local navigation timings do not establish contention under load. |

## TERM-005

Source: [SQL injection](vibecoder-terms-video-subs/2026-06-28-EP-05-sql-injection.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | injection | Candidate | Trace user values into query construction and parameterize values; dynamic identifiers need separate validation. |
| 02 | architecture | Not applicable | An ORM is not required for safe SQL and does not make raw query escapes safe. Preserve existing database access unless a concrete defect warrants change. |
| 03 | source-completeness | Verify | The on-screen SQL payload is absent from the transcript. Do not invent its exact form or claim it was reviewed. |

## TERM-006

Source: [N+1 queries](vibecoder-terms-video-subs/2026-06-29-EP-06-n-plus-one-queries.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | performance | Already covered | Verified 2026-09-12. Scope: [calendar read tests](../lib/calendar/entry-read.test.ts) and the [read-boundary reference](../docs/technical/realtime-and-caching.md#server-paginated-lists) cover embedded reads, server-selected identities and bounded related queries. This is prevention for these owners, not a repository-wide N+1 detector. |
| 02 | data-minimization | Already covered | Verified 2026-09-12. Scope: [operational list SQL assertions](../supabase/tests/operational_list_pages.sql) exercise tenant/employee scope and global filters beyond 1,000 rows; [bounded related reads](../lib/supabase/query-batches.ts) reject overflow. The selected pagination browser group passes both cases for later pages, filtering and mutations. This does not make a join alone proof of authorization or completeness. |

## TERM-007

Source: [Rate limiting](vibecoder-terms-video-subs/2026-06-29-EP-07-rate-limiting.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | abuse-controls | Candidate | Inventory server/provider request windows and identity keys for sensitive/expensive work. |
| 02 | authentication | Candidate | Login brute force and weak-password handling are separate controls; absence of one does not prove absence of the other. |
| 03 | cost-controls | Deferred | Anonymous paid-AI lead magnets require quotas before launch if adopted; the ChatGPT example is not a current WerkFlow feature. |
| 04 | interaction-feedback | Candidate | Rate-limit responses need usable German feedback and recovery, including direct API calls that bypass UI restrictions. |
| 05 | evidence-quality | Not applicable | Legal-risk rhetoric does not establish liability or make a single audit prompt sufficient implementation evidence. |

## TERM-008

Source: [JWTs](vibecoder-terms-video-subs/2026-06-30-EP-08-json-web-tokens.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authentication | Candidate | Inspect signature and claim validation rather than merely parsing a user identifier from a token. |
| 02 | session-security | Candidate | Examine access-token expiry, refresh lifetime/rotation, revocation, and client storage together. |
| 03 | evidence-quality | Verify | A signed token is not encrypted; fifteen minutes is a suggested example. Keep provider-managed auth rather than asking an agent to roll a replacement. |

## TERM-009

Source: [Hashing and encryption](vibecoder-terms-video-subs/2026-07-01-EP-09-hashing-and-encryption.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cryptography | Verify | Hashing and keyed reversible encryption solve different problems. The meat-grinder analogy omits salts, work factors, collisions, and offline guessing. |
| 02 | authentication | Candidate | Confirm passwords stay in the auth provider's supported password-verification path rather than application storage. |
| 03 | transport-security | Verify | Hashing alone is not a protocol for proving a shared secret without transmitting it; preserve TLS and provider authentication semantics. |

## TERM-010

Source: [Server and client components](vibecoder-terms-video-subs/2026-07-01-EP-10-server-and-client-components.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | secrets | Candidate | Inspect what crosses the server/client boundary, including imports and serialized props. |
| 02 | performance | Deferred | Reconsidered 2026-09-12. Optional calendar selectors load bounded data when needed; [real month-view checks](../tests/ui-contracts/month-view.spec.ts) exercise renderer stability. Revisit additional client boundaries/chunks when a measured request-to-usable gap or larger workload identifies browser work. No complete CPU profile is claimed. |
| 03 | architecture | Verify | Server-component defaults and use-client semantics are framework-specific, not true of every React/TypeScript app. Buttons/forms do not all require custom client JavaScript. |

## TERM-011

Source: [Hydration](vibecoder-terms-video-subs/2026-07-01-EP-11-hydration.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | interaction-feedback | Candidate | Distinguish visible server-rendered controls from usable hydrated controls in tests and application feedback. |
| 02 | performance | Already covered | Verified 2026-09-12. Scope: [browser-observation contracts](../tests/ui-contracts/browser-observation.spec.ts), [calendar contracts](../tests/ui-contracts/calendar.spec.ts) and date-range tests distinguish server snapshots, hydrated controls and committed usable rendering. This is not a repository-wide hydration mismatch audit or a requirement to replace all server content with placeholders. |
| 03 | architecture | Verify | Placeholder-plus-useEffect is one solution, not a universal prescription. Prefer stable server inputs, framework IDs, and existing conventions where applicable. |

## TERM-012

Source: [Caching and invalidation](vibecoder-terms-video-subs/2026-07-02-EP-12-caching-and-invalidation.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | caching | Already covered | Verified 2026-09-12. Scope: the [cache-reader inventory](../docs/technical/realtime-and-caching.md#cross-request-reader-inventory) and [calendar contracts](../tests/ui-contracts/calendar.spec.ts) cover retained data, current authorization, scope changes and failure recovery. This does not permit stale privileged data or replace the separate DEV revocation check. |
| 02 | caching | Already covered | Verified 2026-09-12. Scope: [security policy](../docs/technical/security.md) separates private file/operational responses from public static assets. Deployed header/cache behaviour still requires Step 3 verification; this row does not certify CDN configuration. |
| 03 | authorization | Candidate | Feature-flag/configuration TTLs cannot silently preserve revoked permissions or cross-tenant configuration. |
| 04 | caching | Deferred | Reconsidered 2026-09-12. The existing calendar owner retains authorized data with explicit stale/error and recovery states; this is not a general SWR cache. Extend reuse only when a measured need exists and current authorization, mutation confirmation and invalidation remain provable. |

## TERM-013

Source: [Indexes](vibecoder-terms-video-subs/2026-07-03-EP-13-database-indexing.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | performance | Deferred | Reconsidered 2026-09-12. No new index or representative EXPLAIN evidence is claimed. Revisit safe query plans when measured database time or the larger profile warrants an index change, and compare read benefit with write/storage cost. |
| 02 | evidence-quality | Verify | Indexes need not be single-column or simple presorted shortcuts; choose actual Postgres index design rather than literalizing the book analogy. |

## TERM-014

Source: [Migrations](vibecoder-terms-video-subs/2026-07-04-EP-14-database-migrations.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | migrations | Candidate | Keep schema changes in versioned migrations and inspect environment drift. |
| 02 | recovery | Verify | A migration cannot always be rolled back without lost data. Establish compatible forward recovery or restore for destructive transformations. |
| 03 | architecture | Not applicable | The spreadsheet analogy explains structure changes; it does not justify direct editing of live schema. |

## TERM-015

Source: [Transactions](vibecoder-terms-video-subs/2026-07-06-EP-15-transactions-and-atomicity.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | business-integrity | Candidate | Find multi-write operations that must commit or fail together, as illustrated by both sides of a transfer. |
| 02 | business-integrity | Verify | Database atomicity does not include external email/payment effects automatically. Review integration boundaries separately. |
| 03 | agent-governance | Not applicable | The spoken instruction to push and deploy is source content, not authorization. |

## TERM-016

Source: [Connection pooling](vibecoder-terms-video-subs/2026-07-11-EP-16-connection-pooling.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | capacity | Deferred | Reconsidered 2026-09-12. The app uses Supabase HTTP/PostgREST, so raw PostgreSQL pooler tuning is not an app URL change. Measured HTTP pressure is now bounded by the [request scheduler](../docs/technical/realtime-and-caching.md#backend-request-capacity). Revisit provider pool capacity when provider metrics identify connection pressure or a direct database client is introduced. |
| 02 | database-security | Verify | Transaction pooling must fit the client, session-state needs, and prepared-statement support. Do not point every Supabase HTTP request at a raw Postgres pooler. |

## TERM-017

Source: [Promises](vibecoder-terms-video-subs/2026-07-12-EP-17-promises.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | resilience | Candidate | Inspect rejected and unawaited asynchronous work where it can lose errors or mutate after a response. |
| 02 | performance | Already covered | Verified 2026-09-12. Scope: [request reuse tests](../lib/data/read-request-cache.test.ts), [permission lifetime/cancellation tests](../lib/data/read-request-lifetime.test.ts) and [calendar HTTP tests](../lib/calendar/window-http.test.ts) exercise current request ownership; [clock/active-job GET transport](../docs/technical/realtime-and-caching.md) removes those reads from the browser Server Action queue. The [scheduler contracts](../lib/supabase/request-scheduler.test.ts) also enforce bounded pressure, caller context, cancellation and background progress. Dependent writes remain ordered; per-process bounds do not establish whole-provider capacity. |
| 03 | evidence-quality | Verify | Not every filesystem/API function returns a promise, and await does not always require an enclosing async function in module contexts. Hydration is not simply filling the frontend with data. |

## TERM-018

Source: [Event loop and blocking](vibecoder-terms-video-subs/2026-07-13-EP-18-event-loop-and-blocking.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | performance | Deferred | Reconsidered 2026-09-12. Renderer stability has focused component checks, but no whole-app CPU profile is claimed. Profile the browser main thread when response-to-usable timing or a larger workload identifies unexplained rendering cost; function length alone is not evidence. |
| 02 | performance | Verify | Marking CPU work async does not move it to another thread. Distinguish asynchronous I/O from worker execution. |
| 03 | capacity | Deferred | Use worker processing for a measured heavy task that fits the settled infrastructure rule. |
| 04 | interaction-feedback | Deferred | Chunked processing/progress can improve responsiveness but must preserve cancellation, atomicity, and accurate partial-state display. |
| 05 | evidence-quality | Not applicable | The demographic cashier stereotype has no product or engineering relevance. |

## TERM-019

Source: [Memory leaks](vibecoder-terms-video-subs/2026-07-13-EP-19-memory-leaks.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | capacity | Candidate | Consider retained subscriptions, caches, objects, and resources as reliability risks; measure sustained memory growth rather than assume any high usage is a leak. |
| 02 | source-completeness | Verify | Six on-screen prompts are not transcribed. Their wording and individual recommendations are unknown and cannot be marked considered from this file. |

## TERM-020

Source: [Webhooks](vibecoder-terms-video-subs/2026-07-15-EP-20-webhooks.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | webhooks | Candidate | Inventory actual inbound service callbacks separately from outgoing API calls. |
| 02 | business-integrity | Deferred | Stripe checkout is an example; future payment events need authentication, retry, ordering, and duplicate-safe effects. The paperboy analogy does not specify delivery guarantees. |

## TERM-021

Source: [CDN and edge](vibecoder-terms-video-subs/2026-07-16-EP-21-cdn-and-edge.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | caching | Deferred | Reconsidered 2026-09-12. Verify deployed compression, font/image delivery and asset-specific cache headers at Step 3. Local transfer measurements do not prove CDN behaviour. Private HTML/RSC and file URLs must retain their access boundaries; no new CDN is proposed. |
| 02 | observability | Deferred | Reconsidered 2026-09-12. At Step 3, inspect deployment response headers after controlled warm-up for the relevant public asset class. A local load is not CDN-hit evidence, and one first miss is not a defect. Keep protected HTML/RSC and private file URLs outside public-asset assumptions. |
| 03 | source-completeness | Verify | The displayed asset/header values are absent from the transcript; retrieve provider documentation or original visuals if exact values matter. |
| 04 | evidence-quality | Verify | Automatic CDN coverage and nearest-city serving vary by provider, asset, cache policy, and region. |

## TERM-022

Source: [DNS and propagation](vibecoder-terms-video-subs/2026-07-20-dns-and-propagation.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | deployment-security | Candidate | Inventory authoritative DNS, actual records, ownership, and domain-to-deployment routing. |
| 02 | recovery | Candidate | Consider TTL and stale resolver answers in domain migrations and rollback. |
| 03 | evidence-quality | Verify | One hour or two-to-three days is not a universal propagation guarantee. Measure authoritative and resolver behavior rather than waiting blindly. |

## TERM-023

Source: [HTTPS](vibecoder-terms-video-subs/2026-07-21-EP-23-https.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | transport-security | Candidate | Verify encryption and server identity across deployed app, auth, file, and callback paths. |
| 02 | browser-security | Candidate | Check redirects, mixed content, and certificate validity, not just the visible URL prefix. |
| 03 | evidence-quality | Not applicable | HTTPS does not prove a site is trustworthy and HTTP does not by itself prove a scam. The "one letter prevents hacking" framing is not accepted. |

## TERM-024

Source: [HTTP status codes](vibecoder-terms-video-subs/2026-07-22-http-status-codes.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | observability | Candidate | Preserve meaningful response categories for diagnosis while distinguishing HTTP delivery success from successful business effects. |
| 02 | api-contracts | Verify | 4xx does not always mean the user made a fixable mistake; authorization, throttling, and missing resources need distinct handling. |
| 03 | source-completeness | Verify | The displayed full 4xx/5xx grids are absent; use current HTTP reference material when exact code semantics matter. |

## TERM-025

Source: [Pooling repost](vibecoder-terms-video-subs/2026-07-27-EP-16-connection-pooling-repost.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | capacity | Candidate | Same reuse/connection-cost idea as TERM-016.01; retain separate source occurrence. |
| 02 | database-security | Verify | Same transaction-pooling compatibility caveat as TERM-016.02. A repost does not provide additional implementation evidence. |

## TERM-026

Source: [Serverless](vibecoder-terms-video-subs/2026-07-30-EP-24-serverless-functions.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Candidate | Ensure durable state, duplicate protection, and global limits do not depend on one request's process memory. |
| 02 | evidence-quality | Verify | Functions do not necessarily start fresh and die after every request. Warm reuse must not leak data, and durable correctness must not rely on reuse. |
| 03 | capacity | Deferred | Bursty events, thin API glue, and independent scaling are workload examples for later architecture decisions. |
| 04 | architecture | Not applicable | The beginner recommendation to keep everything on one server does not supersede the settled managed stack. |

## TERM-027

Source: [Input validation](vibecoder-terms-video-subs/2026-08-04-EP-25-input-validation.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | input-validation | Candidate | Validate shape, size, and business meaning before side effects at authoritative server boundaries. |
| 02 | interaction-feedback | Candidate | Client validation improves feedback and avoids needless requests, but can be bypassed. |
| 03 | evidence-quality | Not applicable | The video's final client-only recommendation is insufficient as a security measure, even though its earlier explanation describes server expectations. |

## TERM-028

Source: [Optimistic rendering](vibecoder-terms-video-subs/2026-08-05-EP-26-optimistic-rendering.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | interaction-feedback | Already covered | Verified 2026-09-12. Scope: [actual day-view contracts](../tests/ui-contracts/day-view.spec.ts) cover delayed/rejected save and Undo; [calendar contracts](../tests/ui-contracts/calendar.spec.ts) cover retention, failure and reconciliation. Existing list mutation owners remain. The source's claimed 99% success rate never authorizes false success for an unconfirmed action. |
| 02 | business-integrity | Candidate | Deletion still needs permission, error handling, reconciliation, and recovery; a guessed 99% success rate cannot authorize false success feedback. |
| 03 | observability | Already covered | Verified 2026-09-12. Scope: [testing rules](../docs/technical/testing.md) separate pending-feedback contracts from selected authoritative completion/readiness measurements. This does not put a stopwatch in every test or equate optimistic feedback with faster server processing. |

## TERM-029

Source: [Migrations revisited](vibecoder-terms-video-subs/2026-08-11-database-migrations-revisited.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | migrations | Candidate | Version schema changes and preserve existing records, not only new application compatibility. |
| 02 | recovery | Candidate | Treat drops, deletions, and type conversions as explicit data-loss and rollback questions. |
| 03 | security-tests | Candidate | Rehearse migrations with production-like shape/volume while protecting production personal data. The occupied-house analogy highlights continuity, not a specific migration framework. |

## TERM-030

Source: [Hashing revisited](vibecoder-terms-video-subs/2026-08-29-hashing-revisited.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cryptography | Verify | Fixed-size outputs, one-way properties, and collision resistance describe different properties. Choose an algorithm for its actual purpose. |
| 02 | evidence-quality | Not applicable | Hash security does not depend on hiding source code. Public algorithms can be secure, and known algorithms allow offline password guessing. |
| 03 | authentication | Candidate | Password hashing must use provider-supported salts/work factors and avoid plaintext copies; generic hashing is not sufficient. |
