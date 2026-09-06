# Infrastructure, database, compliance, and performance considerations

Reviewed on 2026-09-06 for security and infrastructure fact gathering. Statuses follow [README.md](README.md). These observations identify questions and later revisit triggers. They do not authorize changes or replace provider documentation, legal advice, or current repository evidence. Promotional statistics, absolute guarantees, and promised implementation times are not accepted as evidence.

## INFRA-001

Source: [Production stack recap](infrastructure-video-subs/2026-05-31-full-production-stack-recap.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Candidate | Frontend foundations belong in the system inventory, including browser-visible data and controls. |
| 02 | architecture | Candidate | API and backend logic entry points need explicit ownership. |
| 03 | data-governance | Candidate | Database and file-storage boundaries both matter. |
| 04 | authorization | Candidate | Authentication and permissions are separate checks. |
| 05 | deployment-security | Candidate | Hosting and deployment access, environments, and rollback need inspection. |
| 06 | cost-controls | Candidate | Cloud compute limits and responsibility must be known. |
| 07 | supply-chain | Candidate | Version control and CI/CD permissions belong in the audit. |
| 08 | database-security | Candidate | RLS and its bypass paths need evidence. |
| 09 | abuse-controls | Candidate | Rate limiting must cover actual expensive and sensitive operations. |
| 10 | tenant-isolation | Candidate | Cache/CDN security boundaries first; performance tuning follows. |
| 11 | capacity | Candidate | Record managed load-balancing/scaling limits before adding infrastructure. |
| 12 | observability | Candidate | Error tracking and safe logs need operational ownership. |
| 13 | recovery | Candidate | Availability and recovery require restore evidence, not just provider names. |
| 14 | evidence-quality | Not applicable | Thirteen layers and a claimed percentile over other builders are a teaching taxonomy, not a required service count or maturity score. |

## INFRA-002

Source: [Staging before production](infrastructure-video-subs/2026-07-17-staging-environment-before-production.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | deployment-security | Candidate | Compare preview and production schemas, service behavior, and configuration while preserving separate credentials and sensitive data. "Same environment variables" must not mean copying production secrets/data into previews. |
| 02 | security-tests | Candidate | Verify relevant checks and preview evidence before promotion. An agent's direct-main editing convention does not by itself imply production deployment. |
| 03 | deployment-security | Not applicable | Automatic promotion after passing tests conflicts with the owner's explicit production-release control. |
| 04 | recovery | Candidate | Verify rollback to known application state and migration compatibility; a deploy rollback does not roll back database state automatically. |
| 05 | evidence-quality | Verify | Preview pricing and claims that staging prevents all broken features need current provider evidence and realistic limitations. |

## INFRA-003

Source: [Serverless and containers](infrastructure-video-subs/2026-07-18-serverless-versus-containers-cost.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cost-controls | Candidate | Compare actual managed costs and usage, not user-count thresholds or generic per-invocation assumptions. |
| 02 | operations | Candidate | Include patching, capacity, deployment, support, and founder time in operational cost. Managed platforms still leave application responsibilities. |
| 03 | architecture | Deferred | Revisit separate workers when a real long-running workload exists; preserve the settled infrastructure decision rather than migrate by analogy. |
| 04 | evidence-quality | Verify | Containers are not universally cheaper and most products do not inherently need both models. Measure the workload and current provider pricing before deciding. |

## INFRA-004

Source: [Transactional email delivery](infrastructure-video-subs/2026-07-23-transactional-email-deliverability.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | email-security | Candidate | Verify sender-domain SPF/DKIM and the actual auth/reset delivery path. Mail-server acceptance is not proof of inbox placement. |
| 02 | email-security | Candidate | Consider separation of transactional and marketing reputation when marketing sending exists. |
| 03 | observability | Candidate | Identify observable delivery, bounce, complaint, and failure signals without pretending every recipient inbox is visible. |
| 04 | business-integrity | Deferred | Receipt-delivery and chargeback examples become directly relevant with payment workflows. Authentication email reliability matters now. |

## INFRA-005

Source: [Status and incident communication](infrastructure-video-subs/2026-07-24-status-page-and-incident-communication.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | incident-response | Candidate | Define a communication channel that remains usable when the app's own host fails; a separate status host is one option. |
| 02 | operations | Candidate | Decide maintenance notice timing and the affected-client communication path. |
| 03 | incident-response | Candidate | Define update responsibility, intervals, subscriber notifications, and templates proportionate to the beta client's needs. |
| 04 | evidence-quality | Not applicable | Do not publish a guessed restoration time as fact. State uncertainty and the next update time when recovery duration is unknown. |

## INFRA-006

Source: [Currency, locale, timezone](infrastructure-video-subs/2026-07-28-internationalization-currency-dates-timezones.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | payments | Deferred | Multicurrency checkout and card-country support need an actual international sales requirement and current provider verification. |
| 02 | localization | Candidate | Check German dates, numbers, addresses, and currency against current product expectations. Automatic geolocation-based locale selection is not necessarily appropriate. |
| 03 | time-correctness | Candidate | Distinguish organization/business dates and timezone-aware timestamps, including DST, before scheduling notifications or calculating work periods. |
| 04 | operations | Deferred | User-timezone signup fields and automated communication timing should follow actual scheduling requirements; do not add them merely because the example spans twelve countries. |

## INFRA-007

Source: [Infrastructure and customer limits](infrastructure-video-subs/2026-07-29-infrastructure-choices-set-your-ceiling.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | vendor-risk | Candidate | Record actual provider assurances, regions, support, and limits. Their certifications do not certify WerkFlow's configuration. |
| 02 | procurement | Candidate | State what the present SHK product can support without inventing enterprise promises. Small businesses can still have location/privacy requirements. |
| 03 | procurement | Deferred | Dedicated VPC deployments, enterprise SLAs, support contracts, and own attestations require a concrete customer strategy. |
| 04 | architecture | Not applicable | Ten-customer thresholds, a universal enterprise evolution path, and mandatory infrastructure ownership are unsupported heuristics, not reasons to migrate providers. |

## INFRA-008

Source: [Circuit breakers and time budgets](infrastructure-video-subs/2026-08-17-circuit-breakers-and-cascading-failure.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | resilience | Candidate | Inventory hanging/failing dependencies and safe fallback behavior. A circuit breaker needs correct state ownership under multiple server instances. |
| 02 | capacity | Candidate | Bound resource use per dependency so one slow integration cannot exhaust unrelated work. Pool splitting is implementation-dependent. |
| 03 | resilience | Candidate | Carry an overall deadline through dependent calls instead of granting every hop a fresh full timeout. |
| 04 | business-integrity | Candidate | Fallbacks must preserve failure visibility and must not claim a mutation succeeded when it is merely unconfirmed. |
| 05 | evidence-quality | Verify | The universal breaker/pool prescriptions need measurement and runtime-fit evidence; do not add a general framework before a real failure boundary is identified. |

## INFRA-009

Source: [Error budgets and alerts](infrastructure-video-subs/2026-08-19-error-budgets-and-burn-rate-alerting.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | observability | Candidate | Measure critical workflow outcomes; a responding host can still fail customers. |
| 02 | operations | Candidate | Decide reliability targets, windows, and response policy from SHK operational impact. 0.1% and thirty days are examples, not approved commitments. |
| 03 | observability | Candidate | Consider burn-rate alerts once a meaningful volume and error budget exist. Avoid noisy ratios on a tiny beta sample. |
| 04 | incident-response | Candidate | Record affected organizations, work interrupted, data integrity, and recovery impact. Revenue alone is not the severity metric for operational software. |
| 05 | evidence-quality | Not applicable | The video's "tier 3" label does not define a WerkFlow enforcement tier. |

## INFRA-010

Source: [One application across tenants](infrastructure-video-subs/2026-08-20-multi-tenancy-without-forking-per-client.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Candidate | Check organization configuration stays in the shared product rather than divergent client repositories. |
| 02 | product-scope | Deferred | Tenant flags for CSV, dark mode, and onboarding are examples; add configurable behavior only for accepted product requirements. |
| 03 | configuration | Deferred | Base defaults and scoped overrides need explicit ownership and validation if configuration complexity warrants them. |
| 04 | tenant-isolation | Candidate | Verify tenant resolution before accessing scoped resources. A subdomain, header, or claim must be authenticated against membership, not trusted by name. |

## INFRA-011

Source: [VPS responsibility](infrastructure-video-subs/2026-08-27-moving-to-a-vps-and-inheriting-its-security.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | operations | Deferred | SSH key access, disabled root/password login, inbound firewall, and patch responsibility apply if self-managed servers enter the stack. They do not justify a provider migration now. |
| 02 | deployment-security | Deferred | Nondefault SSH ports reduce noise rather than establish authorization; revisit only with actual SSH infrastructure. |
| 03 | deployment-security | Candidate | Inventory publicly reachable services, including local developer tooling, and distinguish provider-owned from application-owned controls. |
| 04 | evidence-quality | Verify | Claims that every VPS is open or that four commands prevent 99% of attacks are not security guarantees. |

## INFRA-012

Source: [Idempotency](infrastructure-video-subs/2026-08-30-important-concepts-EP-01-idempotency.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | business-integrity | Candidate | Identify operations where retries or double clicks create duplicate records or effects. |
| 02 | business-integrity | Candidate | Reuse one key per intent across retries and inspect atomic duplicate detection/result storage, not a new key for each click. |
| 03 | webhooks | Candidate | Provider retries and repeated email/record creation need explicit delivery semantics where implemented. |
| 04 | cost-controls | Deferred | Reuse/deduplicate paid AI results before launching such endpoints; rate limits alone do not prevent duplicate effects. |
| 05 | evidence-quality | Verify | Not every record write requires a new idempotency framework. Natural idempotence, uniqueness constraints, and transactions may already enforce the intended result. |

## INFRA-013

Source: [Runaway cloud bills](infrastructure-video-subs/2026-09-05-five-checks-against-a-runaway-cloud-bill.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cost-controls | Candidate | Verify Vercel pausing and Supabase spend-cap coverage separately from alerts; record which charges continue and how availability is affected. |
| 02 | data-minimization | Candidate | Server queries must bound rows and fields, not download everything to show ten rows. |
| 03 | resilience | Candidate | Cap attempts, use increasing delay and jitter, and inspect loops across both client and server layers. |
| 04 | abuse-controls | Candidate | Inspect server/provider limits for costly uploads and other paid work, including direct API access. |
| 05 | upload-security | Candidate | Inspect signed-link issuance, validity, replay, downloads, and actual bandwidth cost. A rate limit on issuing a URL may not limit repeated use of the issued URL. |
| 06 | evidence-quality | Candidate | Preserve the caption's distinction between code checks and account billing settings requiring actual verification. A CDN is not a spending cap. |

## INFRA-014

Source: [Retries and timeouts](infrastructure-video-subs/2026-09-05-important-concepts-EP-02-retries-and-timeouts.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | resilience | Candidate | Define outbound deadlines and user-visible progress/failure instead of indefinite waits. |
| 02 | observability | Candidate | Record timed-out or unconfirmed operations without leaking inputs. A poor-network field scenario belongs in acceptance reasoning. |
| 03 | business-integrity | Candidate | Distinguish failed requests from lost responses after successful effects; retry writes only with safe duplicate handling. |
| 04 | resilience | Candidate | Bound transient retries and add backoff/jitter to prevent synchronized retry storms. |
| 05 | evidence-quality | Verify | Reads are not universally harmless or cost-free, three attempts is not a universal policy, and client timeout defaults vary. Select rules for actual libraries and operations. |

## DB-001

Source: [Pooling and first users](database-video-subs/2026-05-20-connection-pooling-for-your-first-users.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | capacity | Candidate | Identify the real database connection path before changing pooler settings; HTTP data access and direct Postgres clients differ. |
| 02 | performance | Deferred | Evaluate cache opportunities with authorization and freshness contracts during the speed pass; Redis is not automatically needed. |
| 03 | capacity | Candidate | Design bounded representative load experiments on authorized environments if needed to test concurrency assumptions. |
| 04 | evidence-quality | Verify | Fifty users, ten connections, 80% savings, and 800-to-50 ms are illustrative, not measured WerkFlow capacity. Verify tool availability before choosing a load tool. |

## DB-002

Source: [Database types](database-video-subs/2026-07-12-picking-a-database-type.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Not applicable | A relational database fits the settled operational model; this overview is not a migration request. |
| 02 | ai-security | Deferred | Vector retrieval for text/images/audio/video requires an actual semantic-search requirement and scoped data boundaries. |
| 03 | architecture | Deferred | Graph nodes/edges and social-network examples are conceptual options, not reasons to add a graph database. Revisit with a real relationship-query bottleneck. |
| 04 | evidence-quality | Not applicable | The creator's food/eye anecdote and claims about what AI codes more easily have no current engineering consequence. |

## DB-003

Source: [Expand-contract migrations](database-video-subs/2026-08-08-expand-contract-migrations-with-rollback.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | migrations | Candidate | Inspect backward-compatible add/backfill/switch/remove sequences and older deployment compatibility. |
| 02 | recovery | Candidate | Require an explicit recovery path before a risky migration; some destructive changes need restore or forward repair rather than a truthful inverse script. |
| 03 | migrations | Candidate | Rehearse on representative data shapes with environment isolation. A current mirror must not mean unrestricted production personal data in test. |
| 04 | operations | Candidate | Verify lock duration, partial failure, validation, and cleanup before claiming no downtime. |

## DB-004

Source: [Disaster recovery](database-video-subs/2026-08-15-disaster-recovery-rpo-and-rto.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | recovery | Candidate | Determine actual snapshot/PITR coverage, retention, and possible loss window. Inspect file bytes as well as metadata. |
| 02 | recovery | Candidate | Rehearse a timed restore into an isolated environment and verify data plus application operation. |
| 03 | operations | Candidate | Ask the owner to choose acceptable downtime and data loss from SHK operations before promising recovery objectives. |
| 04 | vendor-risk | Verify | Current Supabase PITR tier, cost, granularity, and availability need direct provider verification. Quarterly testing is a proposed cadence, not already policy. |

## DB-005

Source: [Replica lag](database-video-subs/2026-08-19-read-replica-lag-and-stale-reads.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-consistency | Deferred | Primary-after-write routing applies only if reads actually use replicas. Verify topology before attributing current Realtime delay to replication. |
| 02 | observability | Deferred | Replica lag thresholds and routing failover need a deployed replica and safe capacity behavior. |
| 03 | business-integrity | Verify | Last-write-wins can discard meaningful edits and is not an automatic safe fix. Operational transforms or explicit conflicts need a domain-specific decision. |
| 04 | architecture | Not applicable | The multiple-region-primary example is not established by this repository's topology. |

## DB-006

Source: [Tenant-specific fields](database-video-subs/2026-08-22-one-column-for-one-client.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | product-scope | Deferred | Metadata/JSONB extension fields need accepted customization requirements and validation, access, and reporting design. |
| 02 | capacity | Candidate | Inspect expensive tenant workloads and fairness so one organization cannot exhaust shared resources. |
| 03 | migrations | Deferred | Separate extension migrations only if such an extension model exists; core migrations still need backward compatibility. |
| 04 | evidence-quality | Verify | One unused column does not establish a 40% slowdown. Tenant joins/extensions also cost resources; measure before changing schema. |

## DB-007

Source: [Table scans and query shape](database-video-subs/2026-08-30-full-table-scans-since-launch.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | performance | Deferred | Inspect query plans, filters, joins, existing indexes, and real data volumes in the speed pass. Sequential scans can be appropriate; do not index every filter automatically. |
| 02 | data-minimization | Candidate | Limit returned fields and rows to the caller's authorized need. |
| 03 | observability | Candidate | Consider safe slow-query statistics, frequency, resource use, and thresholds; avoid logging sensitive parameter values. |
| 04 | evidence-quality | Verify | Provider throttling and tenfold wasted work are source claims, not measurements of this app. |

## COMP-001

Source: [Retention and deletion](compliance-video-subs/2026-07-21-data-retention-versus-deletion-requests.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-governance | Candidate | Map deletion, anonymization, restricted retention, and expiry by actual record category rather than treating account deletion as universal erasure. |
| 02 | legal | Verify | Determine applicable German/EU obligations and contractual roles from authoritative sources and qualified advice. Seven-year US examples are not a WerkFlow schedule. |
| 03 | auditability | Candidate | Record what was retained/deleted, legal basis, clock start, expiry, and outcome with access controls. |
| 04 | architecture | Deferred | A retention engine or separate physical layer needs actual policy complexity; begin with a justified record model, not the video's proposed framework. |

## COMP-002

Source: [US sales-tax nexus](compliance-video-subs/2026-07-23-sales-tax-nexus-across-states.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | legal | Deferred | US state nexus exposure needs review if US sales become part of the business. It is not the present German SHK security checklist. |
| 02 | payments | Deferred | Tax calculation/collection at checkout belongs with future commercial and subscription design; enabling a provider feature does not establish legal compliance. |
| 03 | legal | Deferred | Filing/remittance calendars need actual jurisdictions and professional ownership before implementation. |
| 04 | evidence-quality | Verify | Dollar, transaction, first-sale thresholds, and claims about tax-authority data access require current official sources if this topic becomes relevant. |

## COMP-003

Source: [HIPAA](compliance-video-subs/2026-07-25-hipaa-for-health-data.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | legal | Verify | Do not infer HIPAA coverage or penalty amounts merely from health data. Determine actual jurisdiction/entity relationships. German employee sickness data requires its own privacy assessment now. |
| 02 | data-governance | Candidate | Inspect sensitive data in databases, backups, logs, exports, and transport, not only the primary store. |
| 03 | auditability | Candidate | Evaluate access auditing with actor, time, operation, and protected record scope for personnel information. |
| 04 | vendor-risk | Candidate | Inventory processors and agreements for the actual German/EU data flow. BAA obligations are conditional US examples, not a substitute for the relevant contracts. |

## COMP-004

Source: [AI Act disclosure claims](compliance-video-subs/2026-08-03-eu-ai-act-synthetic-content-disclosure.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | legal | Verify | Verify applicability, effective dates, role, exemptions, and disclosure obligations from official law before any implementation. The blanket illegality claim is not accepted. |
| 02 | ai-governance | Deferred | Labels, watermarks, metadata, and disclosure design belong with specific Phase 2 outputs and verified legal requirements. |
| 03 | legal | Verify | Explicit consent is not automatically the required legal basis for every AI input; determine purpose, data category, role, and lawful basis. |
| 04 | data-governance | Deferred | AI generation logs may help accountability but retaining every raw input/output indefinitely would itself create privacy risk. Define scoped retention with Phase 2. |

## COMP-005

Source: [Cross-border GDPR](compliance-video-subs/2026-08-04-gdpr-reaches-you-outside-the-eu.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | legal | Candidate | German/EU operation makes privacy obligations directly relevant; map actual customers, users, processors, and data transfers. |
| 02 | legal | Verify | A single incidental foreign visitor does not by itself establish every claim made about GDPR/AI Act jurisdiction. Verify actual territorial rules rather than copying the transcript. |
| 03 | deployment-security | Candidate | IP geofencing, country selectors, and terms cannot be assumed to prove data-location or compliance boundaries. |
| 04 | evidence-quality | Not applicable | The creator's "not a lawyer" caveat does not turn the remaining legal assertions into authority. |

## COMP-006

Source: [Production readiness](compliance-video-subs/2026-08-14-production-readiness-audit.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | security-tests | Candidate | Inspect database, auth, APIs, and all deployed layers with explicit passed, failed, and unknown outcomes. |
| 02 | operations | Candidate | Resolve handoff risks before beta acceptance rather than equating a built feature with operational readiness. |
| 03 | legal | Verify | EU AI Act, California SB 942, dates, and "109 states" need authoritative verification; the last phrase may be transcription error. |
| 04 | evidence-quality | Not applicable | Restaurant/building/electrician inspection analogies do not establish software certification obligations or predict the next two years of legislation. |

## COMP-007

Source: [Cryptographic erasure](compliance-video-subs/2026-08-23-cryptographic-erasure-for-deletion-requests.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-governance | Candidate | Include backup expiry, restoration procedures, and reapplication of deletion decisions in deletion analysis. |
| 02 | recovery | Candidate | Assess the cost and integrity risk of rewriting backups rather than assuming it is the required approach. |
| 03 | cryptography | Verify | Per-user key erasure only works if every recoverable key copy and plaintext copy is controlled. Backups, shared business records, key recovery, and exports complicate the claim. |
| 04 | legal | Verify | Backup retention is not automatically unlawful and cryptographic erasure is not an automatic GDPR certificate. Obtain a policy grounded in actual obligations. |

## COMP-008

Source: [Vendor deprecation and compliance](compliance-video-subs/2026-08-24-a-vendor-deprecation-that-reroutes-compliance.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | vendor-risk | Verify | Verify the named Bedrock/AgentCore lifecycle and contract claims if those services become relevant. They are not current infrastructure assumptions. |
| 02 | architecture | Deferred | An internal provider boundary can limit real coupling, but blanket SDK wrappers add maintenance. Revisit with an actual provider integration or migration. |
| 03 | vendor-risk | Candidate | Recheck contractual coverage, region, subprocessors, and data paths after service changes. A prior agreement may not cover a renamed/replaced service automatically. |
| 04 | operations | Deferred | Plan supported-version migration before a verified deprecation deadline, not in response to unverified video urgency. |

## PERF-001

Source: [Five speed ideas](performance-video-subs/2026-06-21-five-ways-to-make-a-vibecoded-app-faster.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | performance | Deferred | Inspect response compression on the actual deployment during speed work. |
| 02 | performance | Deferred | Evaluate batch database writes while preserving authorization, constraints, atomicity, and useful error handling. |
| 03 | observability | Candidate | Break measured user latency into request, server, database, and rendering contributions rather than guessing the bottleneck. |
| 04 | interaction-feedback | Deferred | Evaluate prompt pending/optimistic feedback with confirmed outcome and rollback behavior; no optimistic success for an unconfirmed sensitive action. |
| 05 | caching | Deferred | Evaluate SSR/PPR/static work reuse without exposing personalized data or breaking freshness. |

## PERF-002

Source: [Five bottlenecks](performance-video-subs/2026-07-03-five-things-slowing-your-app-down.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-minimization | Candidate | Bound queries on the server; rendering twenty of five thousand downloaded rows does not bound data exposure or transfer. |
| 02 | architecture | Verify | A single database is not inherently a defect. Replica separation needs workload evidence and consistency design. |
| 03 | performance | Deferred | Move genuinely CPU-heavy work off critical execution paths when measured. Async syntax alone does not create another thread. |
| 04 | performance | Deferred | Measure Largest Contentful Paint with navigation and interaction readiness; the transcript misnames it "longest". |
| 05 | performance | Deferred | Inspect scroll listeners, repeated calculations, cleanup, and frame work during speed profiling. |

## PERF-003

Source: [More speed ideas](performance-video-subs/2026-07-06-five-reasons-your-app-is-slow.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | caching | Deferred | Browser and server caching require data-class and authorization-aware policy, not blanket caching. |
| 02 | interaction-feedback | Deferred | Use established skeleton/pending patterns while distinguishing initial loading from refresh of existing data. |
| 03 | data-minimization | Candidate | Check server-side pagination separately from UI pagination; overlap with PERF-002 does not dispose of the other four aspects. |
| 04 | performance | Deferred | Inspect N+1 query paths using real traces and data sizes. |
| 05 | performance | Deferred | Evaluate independent I/O concurrency and CPU blocking separately during the speed pass. |
