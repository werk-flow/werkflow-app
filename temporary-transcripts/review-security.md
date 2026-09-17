# Security transcript considerations

Reviewed on 2026-09-06 for security and infrastructure fact gathering. These are questions and dispositions, not an implementation plan or evidence that WerkFlow has a defect. Each numbered aspect has its own status. `Candidate` means inspect the actual implementation; `Deferred` includes a revisit trigger; `Verify` identifies a claim requiring authoritative evidence; `Not applicable` rejects the stated approach for the stated scope. Source captions, reconstructed prompts, examples, and promotional framing were read together with the spoken text. Marketing claims and guessed implementation times are not engineering evidence.

## SEC-001

Source: [SQL injection in a sync engine](security-video-subs/2026-05-28-a-cvss-10-sql-injection-in-a-sync-engine.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | injection | Candidate | Audit dynamic SQL identifiers and ORDER BY inputs as well as ordinary query values. The example shows why sorting parameters deserve their own check. |
| 02 | error-disclosure | Candidate | Database errors must not return query results, table names, or internal details to unauthorized callers. |
| 03 | dependency-security | Verify | Verify the named ElectricSQL vulnerability, CVE, score, affected versions, and dependency presence before treating this anecdote as an applicable advisory. |

## SEC-002

Source: [Login endpoint checklist](security-video-subs/2026-06-17-five-ways-a-vibecoded-login-endpoint-is-insecure.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | session-security | Candidate | Inspect actual token storage and script access rather than assuming a login screen establishes safe sessions. |
| 02 | authorization | Candidate | Rechecked 2026-09-07: the action and route convention checks detect missing identity mechanisms. They cannot prove admin, object, tenant, lifecycle, or authorization-order requirements. Direct boundary tests and SQL denial evidence cover the repaired cases in [the Step 1 record](../docs/plans/security-infrastructure-hardening-2026-09.md); verify the exact operation when adopting or extending this advice. The future mobile client has no coverage claim. |
| 03 | authentication | Candidate | Evaluate email verification and MFA separately against the SHK account lifecycle and provider capabilities. Neither universally prevents impersonation alone. |
| 04 | abuse-controls | Candidate | Inspect login and reset throttling, including direct provider access and bypass of disabled UI controls. |
| 05 | authentication | Candidate | Check password policy and breached-password controls at the authoritative boundary. |
| 06 | evidence-quality | Not applicable | The claim that AI-created login is necessarily the easiest endpoint to hack and the offered copy-paste prompts do not establish this repository's state. |

## SEC-003

Source: [Five security holes](security-video-subs/2026-07-01-five-security-holes-in-ai-written-apps.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | injection | Candidate | Follow user-controlled values into shell execution and reject command construction from untrusted strings. |
| 02 | cryptography | Candidate | Inventory cryptographic uses and distinguish password hashing, integrity hashes, signatures, and encryption before judging an algorithm. |
| 03 | webhooks | Candidate | Inventory incoming external events and verify their authenticity before applying effects. |
| 04 | upload-security | Candidate | Check file and request limits, decompression limits where archives are processed, and memory consumption. The petabyte example is illustrative rather than a sizing requirement. |
| 05 | injection | Candidate | Trace untrusted data into raw HTML rendering and verify context-appropriate handling. |

## SEC-004

Source: [Changing a URL to access another user's data](security-video-subs/2026-07-01-reading-another-users-data-by-changing-a-url.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authorization | Candidate | Test copied and modified record URLs across users, roles, and organizations. Authentication is not object authorization. |
| 02 | session-security | Candidate | Test access after logout, including stale browser storage and replay of previously valid credentials. |
| 03 | session-security | Verify | Check provider token revocation semantics before promising immediate rejection of every previously issued access token. Browser storage removal alone cannot prove server revocation. |

## SEC-005

Source: [API audit and versioning](security-video-subs/2026-07-19-api-surface-audit-and-versioning.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-minimization | Candidate | Inventory response fields, personal data, internal relationships, and identifiers. Return only information required and authorized for the caller. |
| 02 | authorization | Candidate | Test enumeration and object access independently of whether identifiers are sequential or UUIDs. Unpredictability does not provide authorization. |
| 03 | api-contracts | Deferred | Public API documentation, integration contracts, versioning, changelogs, and migration windows become relevant when an external API consumer exists. A blanket /v1 rewrite is not justified by this video. |
| 04 | procurement | Deferred | Evaluate API quality as buyer evidence when integrations or enterprise procurement enter scope. The claimed universal buyer behavior is anecdotal. |

## SEC-006

Source: [Session lifetime](security-video-subs/2026-07-22-session-expiry-and-token-lifetime.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | session-security | Candidate | Decide session duration from sensitive personnel data, shared devices, field usability, and loss of a device. Inspect refresh-token and access-token settings separately. |
| 02 | session-security | Candidate | Consider session visibility, revocation, and concurrent-device policy without assuming legitimate phone and office use must be capped arbitrarily. |
| 03 | session-security | Verify | Determine what password change, reset, offboarding, and explicit revocation actually invalidate, and measure any surviving token window. The video's instant-revocation promise needs provider-specific verification. |
| 04 | evidence-quality | Not applicable | Six-month session examples and claims about framework defaults do not establish WerkFlow's actual configuration. |

## SEC-007

Source: [Enterprise auth and compliance](security-video-subs/2026-07-25-saml-sso-and-soc2-for-enterprise-deals.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authentication | Deferred | SAML and enterprise identity-provider integration need a concrete SHK customer requirement before adding them. |
| 02 | procurement | Candidate | Collect provider security documentation and identify the distinction between a provider attestation and WerkFlow's own controls. |
| 03 | vendor-risk | Deferred | Record portability risks when auth requirements change. The settled infrastructure decision is not reopened by a generic enterprise-sales claim. |
| 04 | evidence-quality | Verify | Verify actual tier availability, procurement requirements, and migration costs. Enterprise buyers do not all follow the video's categorical behavior. |

## SEC-008

Source: [Weekend-build audit](security-video-subs/2026-07-27-security-audit-of-a-weekend-build.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | error-disclosure | Candidate | Separate useful German public error feedback from restricted, redacted diagnostic records. |
| 02 | browser-security | Candidate | Inspect deployed CSP, frame protection, and HSTS across success and failure responses. Compatibility matters for streaming, scripts, and signed file access. |
| 03 | input-validation | Candidate | Inventory forms, parameters, queries, and malformed payload boundaries, including SQL and HTML sinks. |
| 04 | abuse-controls | Candidate | Inspect exposed endpoint traffic controls and useful security monitoring. |
| 05 | evidence-quality | Not applicable | Five-minute configuration claims and assertions that an auditor would shut every AI-built app down are promotional, not acceptance criteria. |

## SEC-009

Source: [Committed secrets](security-video-subs/2026-08-01-secrets-committed-to-the-repo.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | secrets | Already covered | Rechecked 2026-09-07. Scope: exact private-credential and reviewed credential-pattern scans found no matches in 198 reachable commits, 5,002 blobs, current tracked/unignored files, and production login HTML plus 17 referenced JavaScript assets. Ignored credential values were compared only in memory. [The Step 1 record](../docs/plans/security-infrastructure-hardening-2026-09.md) owns evidence and limits. This does not certify unknown historical credentials, provider logs, protected preview, or all authenticated/lazy chunks; recheck changed delivered output. |
| 02 | secrets | Candidate | If exposure is verified, revoke and rotate the affected credential and document the boundary. Deleting a file does not revoke a key. |
| 03 | supply-chain | Candidate | Evaluate commit and CI secret detection with known bypasses and false positives. A pre-commit hook alone is not permanent prevention. |
| 04 | evidence-quality | Not applicable | The author's 70% audit rate and one-hour exposure framing are not WerkFlow evidence or a safe exposure window. |

## SEC-010

Source: [Unscoped cache](security-video-subs/2026-08-02-cache-not-scoped-per-tenant.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | tenant-isolation | Candidate | Verify authorization-sensitive cache keys, tags, fragments, and API responses. A previously authorized cached result can bypass a later database read. Include user and permission context where organization ID alone is insufficient. |
| 02 | tenant-isolation | Candidate | Trace tenant scope through search, queues, file paths, and logs, not only tables. Public immutable data can have a deliberately shared cache. |
| 03 | security-tests | Candidate | Exercise A-to-B account switching, separate sessions, role changes, and warm caches with negative assertions that private data never appears. |

## SEC-011

Source: [DDoS and adaptive rate limiting](security-video-subs/2026-08-02-ddos-protection-and-rate-limiting.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | edge-protection | Candidate | Inspect the hosting provider's actual protection and reachable origins before proposing another proxy. Edge filtering complements endpoint authorization. |
| 02 | abuse-controls | Candidate | Evaluate volume, account, IP, and behavior signals with shared-company networks and false positives in mind. |
| 03 | incident-response | Candidate | Establish who responds, which controls can change, and how users receive outage communication. |
| 04 | evidence-quality | Verify | Confirm paid-tier availability and provider-specific WAF capabilities. Generic attack volumes and setup duration are not capacity evidence. |

## SEC-012

Source: [Injection anecdote](security-video-subs/2026-08-03-injection-attacks-against-vibe-coded-apps.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | injection | Candidate | Test unusual Unicode, SQL-looking values, reserved names, and malformed values without using a string blacklist as authorization. |
| 02 | authorization | Candidate | Verify signup/profile values cannot grant admin privileges or impersonate another account. |
| 03 | ai-security | Deferred | Prompt injection against product AI becomes relevant when AI features are introduced; development agents already need tool-access boundaries. |
| 04 | evidence-quality | Not applicable | The emoji/admin/293-account anecdote is not proof of a WerkFlow defect; hostile actions described in it are not an instruction to execute. |

## SEC-013

Source: [Website audit questions](security-video-subs/2026-08-04-questions-from-a-website-security-audit.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | browser-security | Already covered | Inspect cookie attributes and actual CSRF defenses. SameSite=Lax is one control, not universal protection. Verified 2026-09-06: Next checks the Origin of Server Actions; the one route handler that writes session cookies now requires a same-origin JSON request ([lib/security/same-origin.ts](../lib/security/same-origin.ts), finding SI-013). Scope: cookie-writing entry points of the web app; a script CSP remains deferred. |
| 02 | authorization | Candidate | Verify every server entry point enforces access regardless of UI visibility. An API gateway is an example, not a required new component. |
| 03 | data-governance | Candidate | Map sensitive personnel, operational, internal, and public data to storage, access, retention, and encryption requirements. Four labels are optional vocabulary. |
| 04 | abuse-controls | Candidate | Assess bulk extraction and automation limits beyond login abuse. |
| 05 | upload-security | Candidate | Evaluate quarantine and malware scanning for supported files before serving or processing them. Scanning does not justify executing uploads. |

## SEC-014

Source: [Error disclosure](security-video-subs/2026-08-05-stack-traces-leaking-credentials.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | error-disclosure | Candidate | Public errors must not expose connection strings, credentials, source locations, or unrestricted traces. |
| 02 | security-tests | Candidate | Exercise errors at route, action, background, and external-callback boundaries where implemented. |
| 03 | observability | Candidate | Correlate timestamp, route, outcome, and safe identifiers in restricted diagnostics so failures can be investigated. |
| 04 | data-minimization | Not applicable | Logging every input and session indiscriminately would conflict with sensitive-data handling. Select fields and redact credentials and personal data. |

## SEC-015

Source: [Login checklist repost](security-video-subs/2026-08-06-five-ways-a-vibecoded-login-endpoint-is-insecure-repost.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | session-security | Candidate | Repeats SEC-002.01 on token storage; retain this occurrence when updating that topic. |
| 02 | authorization | Candidate | Repeats SEC-002.02 on server admin checks. |
| 03 | authentication | Candidate | MFA/one-time-password wording differs from the original's email-verification wording. Evaluate these separately rather than declaring the entire repost identical. |
| 04 | abuse-controls | Candidate | Repeats login and password-reset throttling. |
| 05 | authentication | Candidate | Frontend password rules are explicitly mentioned here; server enforcement and breached-password checking remain required audit questions. |
| 06 | agent-governance | Not applicable | Sharing a video URL with an agent does not authorize automatic implementation of its recommendations. |

## SEC-016

Source: [Agent permissions and audit](security-video-subs/2026-08-12-ai-agent-permissions-and-audit-trail.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | agent-security | Candidate | Inspect development-tool credentials, environment access, network destinations, and automatic gates; human approval alone cannot prove safe execution. |
| 02 | auditability | Candidate | Record tool/action identity, target, change, outcome, and time with tamper resistance and redaction. Avoid indiscriminate secret-bearing tool-output retention. |
| 03 | security-tests | Candidate | Define repeatable evidence for changed boundaries and release checks, using the current group system rather than a full audit on every edit. |
| 04 | evidence-quality | Verify | The government-evaluation incident is unverified and promotional; it does not establish any present compromise. |

## SEC-017

Source: [Rapid-fire checklist](security-video-subs/2026-08-14-a-rapid-fire-application-security-checklist.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | browser-security | Already covered | HSTS on deployed HTTPS responses. Verified 2026-09-06: production sends Strict-Transport-Security with a two-year max-age from Vercel ([docs/technical/environments.md](../docs/technical/environments.md)). Scope: app.werk-flow.app; preload and includeSubDomains are an open owner decision. |
| 02 | browser-security | Candidate | CSRF defenses matched to action and cookie mechanisms. |
| 03 | session-security | Candidate | Session invalidation after password changes. |
| 04 | authentication | Candidate | Expiring and single-use reset links. |
| 05 | authentication | Candidate | Enumeration resistance in signup, login, and reset responses. |
| 06 | upload-security | Candidate | Allowed upload types and actual-content checks. |
| 07 | webhooks | Deferred | Payment webhook verification when payment integration enters scope; inspect other existing callbacks now. |
| 08 | business-integrity | Deferred | Server-owned prices and entitlement decisions when commercial billing enters scope. |
| 09 | ai-security | Deferred | Product prompt-injection boundaries before Phase 2; no claim that a filter can eliminate injection. |
| 10 | cost-controls | Deferred | AI quotas before exposing a paid generation feature. |
| 11 | abuse-controls | Candidate | Request body and processing-size limits. |
| 12 | abuse-controls | Candidate | Password-reset abuse limits. |
| 13 | input-validation | Verify | Blanket sanitization before storage is too broad. Choose validation and encoding at the relevant data/sink boundary. |
| 14 | browser-security | Candidate | Inspect CORS origins and credential behavior. |
| 15 | deployment-security | Candidate | Inspect directory listings and public build artifacts where the host exposes them. |
| 16 | authorization | Not applicable | Renaming a default admin path is not a substitute for server authorization. |
| 17 | abuse-controls | Candidate | Evaluate lockout or challenge behavior without allowing attackers to lock out coworkers. |
| 18 | auditability | Candidate | Define security events and redacted evidence. |
| 19 | session-security | Candidate | Cookie Secure, SameSite, and script-access attributes appropriate to the auth integration. |
| 20 | database-security | Candidate | Database role privileges and bypass paths. |
| 21 | evidence-quality | Candidate | Preserve the caption's caveat that a checklist does not replace adversarial testing. |

## SEC-018

Source: [Checklist 1](security-video-subs/2026-08-15-security-checklist-1-exposed-secrets-and-access.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | secrets | Candidate | Database credential exposure. |
| 02 | secrets | Candidate | Public .env files. |
| 03 | secrets | Candidate | Hardcoded API keys and tokens. |
| 04 | authentication | Candidate | Missing or weak authentication. |
| 05 | authorization | Candidate | Missing server-side authorization. |
| 06 | tenant-isolation | Candidate | Other users' record access. |
| 07 | database-security | Candidate | Excessive database read/write permissions. |
| 08 | upload-security | Candidate | Supabase/R2 and any actual storage access configuration; Firebase and S3 are examples, not assumed dependencies. |
| 09 | authorization | Candidate | Privileged admin routes. |
| 10 | deployment-security | Candidate | Production debug pages and developer tools. |
| 11 | secrets | Candidate | Build-log credential leakage. |
| 12 | error-disclosure | Candidate | Verbose errors and exposed internals. |
| 13 | secrets | Candidate | Git history containing sensitive values. |
| 14 | secrets | Candidate | Secrets compiled into browser JavaScript. |
| 15 | authorization | Candidate | Client-only permission checks. |
| 16 | input-validation | Candidate | Missing boundary validation. |
| 17 | injection | Candidate | SQL injection including dynamic queries. |
| 18 | injection | Deferred | NoSQL injection if a NoSQL query boundary is introduced; inspect actual dependencies before applying that label. |

## SEC-019

Source: [Context-aware access](security-video-subs/2026-08-15-zero-trust-abac-session-anomaly-detection.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authentication | Candidate | Consider step-up authentication for sensitive actions using actual threat and field-work patterns. Time of day or travel alone is not proof of attack. |
| 02 | authorization | Deferred | A new ABAC policy engine needs a concrete gap beyond existing organization, role, assignment, and record rules. |
| 03 | service-security | Candidate | Authenticate and authorize internal and service-to-service operations; network location alone is insufficient. |
| 04 | session-security | Deferred | Device fingerprinting, IP reputation, impossible-travel scoring, and continuous anomaly detection need privacy, reliability, and support analysis before adoption. |
| 05 | evidence-quality | Not applicable | The video's "tier 3 RBAC" terminology has no relationship to WerkFlow's three-tier enforcement system. |

## SEC-020

Source: [Exposed proxy origin](security-video-subs/2026-08-16-cloudflare-origin-ip-exposure.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | edge-protection | Candidate | Inventory actual domains, deployment aliases, direct origins, and storage endpoints before relying on an edge control. |
| 02 | deployment-security | Candidate | Review DNS history, subdomains, mail records, and headers where they can expose a bypass route. |
| 03 | edge-protection | Verify | Cloudflare IP allowlists and origin certificates apply to a proxied origin setup. R2 usage does not prove this app has that topology; verify Vercel-supported controls. |
| 04 | transport-security | Candidate | Verify encryption and certificate validation along every actual hop, including any proxy-to-origin link. |

## SEC-021

Source: [RAG tenant leakage](security-video-subs/2026-08-16-rag-vector-db-tenant-data-leakage.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | ai-security | Deferred | Before RAG exists, carry source ownership and permission metadata into chunks and restrict retrieval to authorized content. |
| 02 | ai-security | Deferred | Treat uploaded instructions as untrusted content. Injection-pattern scanning can be a signal, not the security boundary. |
| 03 | tenant-isolation | Deferred | Recheck source/chunk authorization before model exposure and output, including changed permissions and revoked documents. |
| 04 | data-governance | Deferred | HR, contracts, pricing, and internal documents require distinct access classes rather than one shared retrieval pool. Revisit with Phase 2 design. |

## SEC-022

Source: [Checklist 2](security-video-subs/2026-08-19-security-checklist-2-injection-and-session-flaws.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | injection | Candidate | Cross-site scripting. |
| 02 | browser-security | Candidate | Cross-site request forgery. |
| 03 | upload-security | Candidate | Unsafe file uploads. |
| 04 | upload-security | Candidate | Path traversal and object-key manipulation. |
| 05 | outbound-security | Candidate | Server-side URL fetch and SSRF exposure. |
| 06 | authentication | Candidate | Reset-flow misuse and token handling. |
| 07 | session-security | Candidate | Session management and lifecycle. |
| 08 | cryptography | Candidate | JWT verification, keys, algorithm configuration, and claims. |
| 09 | browser-security | Candidate | Overly broad CORS. |
| 10 | abuse-controls | Candidate | Missing request throttles. |
| 11 | deployment-security | Candidate | Preview, test, and staging exposure. |
| 12 | secrets | Candidate | Default credentials outside explicitly disposable local test setup. |
| 13 | webhooks | Candidate | Callback signature verification. |
| 14 | business-integrity | Deferred | Client-only payment or subscription decisions when those features exist. |
| 15 | authorization | Candidate | IDOR/BOLA across record identifiers and actions. |
| 16 | input-validation | Candidate | Trust in caller-controlled API parameters. |
| 17 | observability | Candidate | Personal data and secrets in logs. |
| 18 | deployment-security | Candidate | Public source maps and the actual information they reveal. |

## SEC-023

Source: [Cloudflare controls](security-video-subs/2026-08-20-cloudflare-rate-limiting-bot-management-waf.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | abuse-controls | Candidate | Inspect edge coverage for login, registration, and resets plus direct Supabase entry points. |
| 02 | edge-protection | Candidate | Distinguish credential stuffing, scraping, and scanners; challenge policies must preserve legitimate field devices and shared office IPs. |
| 03 | edge-protection | Verify | Determine actual WAF provider, plan, and supported rules. A generic SQL/XSS/path filter cannot implement every OWASP access-control or business-logic defense. |
| 04 | cost-controls | Candidate | Correlate blocked versus origin-served traffic with resource usage rather than assuming installed protection is effective. |

## SEC-024

Source: [Checklist 3](security-video-subs/2026-08-22-security-checklist-3-dependencies-and-ai-access.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | dependency-security | Already covered | Rechecked 2026-09-07. Scope: dependency changes now have a bounded advisory gate with exact reviewed exceptions. The prior runtime `ws` dependency was not development-only, and its advisory was not server-only. Compatible patch overrides remove that affected version and several tooling findings. [The Step 1 record](../docs/plans/security-infrastructure-hardening-2026-09.md) owns the final audit evidence. Recheck package versions, advisory changes, and runtime reachability whenever dependencies change. |
| 02 | supply-chain | Candidate | Malicious packages and install hooks. |
| 03 | ai-security | Deferred | Product prompt injection before adding AI; developer tooling remains in current scope. |
| 04 | agent-security | Candidate | Agent permissions and exposed tools. |
| 05 | database-security | Candidate | Excessive database privileges. |
| 06 | auditability | Candidate | Missing security audit records. |
| 07 | observability | Candidate | Missing alerting and monitoring. |
| 08 | recovery | Candidate | Backup availability and restore evidence. |
| 09 | authorization | Candidate | Exposed internal dashboards. |
| 10 | browser-security | Candidate | Response security headers. |
| 11 | session-security | Candidate | Cookie attributes. |
| 12 | cryptography | Candidate | Sensitive-data encryption boundaries. |
| 13 | tenant-isolation | Candidate | Cross-organization shared-resource access. |
| 14 | agent-governance | Candidate | Independent review of AI-written changes. |
| 15 | input-validation | Candidate | Mass assignment of protected fields. |
| 16 | injection | Candidate | Shell command injection. |
| 17 | injection | Candidate | Unsafe deserialization paths if present. |
| 18 | authentication | Candidate | OAuth configuration and redirects. |

## SEC-025

Source: [Forged requests and API contracts](security-video-subs/2026-08-23-forged-requests-and-unsigned-endpoints.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | service-security | Verify | HMAC signing may fit server-to-server integrations. A shared secret distributed to ordinary browsers cannot authenticate a trusted client. Use the actual auth/CSRF boundary for app writes. |
| 02 | transport-security | Candidate | Verify request integrity and TLS rather than assuming a body signature replaces transport protection. |
| 03 | api-contracts | Deferred | Version paths, version negotiation, stable v1/v2 behavior, and consumer migration when external contracts exist. |
| 04 | api-contracts | Deferred | Sunset headers, retirement dates, and usage monitoring for endpoints with external consumers. |

## SEC-026

Source: [Mobile wrapper security](security-video-subs/2026-08-23-web-app-wrapped-as-a-mobile-app.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | mobile-security | Deferred | Review app-directory, WebView-cache, and rooted-device exposure when implementing the future mobile app. |
| 02 | mobile-security | Deferred | Use platform secure storage for user credentials; service secrets must remain server-side even if a keychain is available. |
| 03 | transport-security | Verify | Lack of certificate pinning does not imply ordinary verified TLS is plaintext. Pinning needs threat and certificate-rotation analysis before mobile adoption. |
| 04 | mobile-security | Deferred | Verify deep-link ownership, callbacks, reset links, and payment links against the chosen native platform. Do not assume arbitrary URI schemes prove origin. |
| 05 | evidence-quality | Not applicable | Capacitor is an example; the repository's future React Native direction is not replaced by this video. |

## SEC-027

Source: [Checklist 4](security-video-subs/2026-08-24-security-checklist-4-auth-ci-cd-and-ai-agents.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authentication | Candidate | MFA availability and sensitive-action policy. |
| 02 | authentication | Candidate | Account enumeration across user flows. |
| 03 | business-integrity | Candidate | Business-rule abuse beyond syntactically valid inputs. |
| 04 | business-integrity | Candidate | Concurrent critical operations and lost updates. |
| 05 | webhooks | Candidate | Replay resistance and duplicate-event effects where callbacks exist. |
| 06 | deployment-security | Candidate | CI/CD permissions and deployment credentials. |
| 07 | supply-chain | Candidate | Third-party GitHub Actions trust. |
| 08 | supply-chain | Candidate | Build dependency/action pinning and review. |
| 09 | security-tests | Candidate | Security checks that allow processing when verification fails. |
| 10 | resilience | Candidate | Missing deadlines on external calls. |
| 11 | ai-security | Deferred | Sensitive output disclosure before product AI launch. |
| 12 | agent-security | Candidate | Execution of generated code/output in development tools; product execution is future scope. |
| 13 | agent-security | Candidate | Excessive agent privileges. |
| 14 | session-security | Candidate | Sensitive browser storage. |
| 15 | authentication | Already covered | Open redirects and caller-controlled destinations. Verified 2026-09-06: the auth callback accepts only same-origin return paths ([lib/auth/return-path.ts](../lib/auth/return-path.ts), finding SI-003). Scope: /auth/callback; no other caller-controlled redirect exists in the app. |
| 16 | service-security | Candidate | Realtime/WebSocket authorization; GraphQL requires a boundary inventory rather than assumed usage. |

## SEC-028

Source: [Stripe webhook verification](security-video-subs/2026-08-24-unverified-stripe-webhooks.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | webhooks | Deferred | When payments exist, verify provider signatures using current official SDK behavior before fulfillment or entitlement changes. |
| 02 | business-integrity | Deferred | Store event identity and apply duplicate-safe effects atomically; replay, concurrent deliveries, and legitimate retry are separate cases. |
| 03 | webhooks | Verify | Random URL paths and provider IP allowlists are optional extra controls, not replacements for signatures. Verify actual delivery IP guarantees and raw-body requirements. |

## SEC-029

Source: [SSRF through URL fetching](security-video-subs/2026-08-25-ssrf-through-an-agent-that-fetches-urls.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | outbound-security | Candidate | Inventory server-side user-controlled URLs, including non-AI integrations; inspect access to private networks, metadata services, and admin systems. |
| 02 | outbound-security | Candidate | Verify approved destinations, resolved addresses, connection target, and every redirect against rebinding and time-of-check differences. |
| 03 | error-disclosure | Candidate | Avoid returning internal network diagnostics. Preserve safe private evidence; timeout does not by itself prove that a service is listening. |
| 04 | ai-security | Deferred | Apply the same enforced fetch boundary to future product agents, independent of their prompts. |

## SEC-030

Source: [Malicious dependency](security-video-subs/2026-08-26-a-dependency-that-exfiltrates-your-environment.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | supply-chain | Candidate | Inspect direct/transitive dependencies, package identity, install scripts, provenance, and unexpected network access. |
| 02 | supply-chain | Verify | Fewer than 100 downloads or a maintainer change in 90 days are investigation signals, not reliable maliciousness tests; popularity does not prove safety either. |
| 03 | secrets | Verify | Passing selected secrets into a module does not isolate malicious code sharing the same process.env. Establish process, build, and credential boundaries where isolation is required. |
| 04 | supply-chain | Candidate | Verify frozen lockfile installation and artifact integrity in the actual Bun/Vercel workflow. Integrity does not prove a pinned package is benign. |

## SEC-031

Source: [Credentialed CORS](security-video-subs/2026-08-26-cors-open-to-any-origin-with-credentials.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | browser-security | Candidate | Inspect reflected origins, credentials, exact allowed origins, and actual browser behavior. |
| 02 | browser-security | Verify | Literal wildcard-plus-credentials and reflected arbitrary origins are distinct. CORS is not authentication and does not control every request or automatically cause cookies to be sent. |
| 03 | session-security | Candidate | Check SameSite and request-forgery protection without breaking legitimate auth callbacks. |
| 04 | input-validation | Candidate | Restrict implemented methods and headers at the server; preflight restrictions do not prevent direct non-browser requests. |

## SEC-032

Source: [Prompt injection in product AI](security-video-subs/2026-08-28-prompt-injection-against-your-own-ai-feature.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | ai-security | Deferred | Before Phase 2, authorize model tool/data access outside model instructions. |
| 02 | tenant-isolation | Deferred | Scope model-accessible data by organization, role, assignment, and record permission; literal record ownership alone is insufficient for SHK collaboration. |
| 03 | ai-security | Deferred | Evaluate output validation and source authorization while keeping secrets out of model context. Output filtering cannot guarantee prevention after unauthorized retrieval. |

## SEC-033

Source: [Mobile transport](security-video-subs/2026-08-29-mobile-traffic-in-plain-text.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | transport-security | Verify | The video conflates missing certificate pinning with readable plaintext. Verify platform TLS behavior and threat assumptions before adopting its claim. |
| 02 | cryptography | Deferred | Additional field encryption needs a specific threat, key ownership, and recovery design; it is not a default substitute for correct TLS. Revisit with mobile/security data classification. |
| 03 | mobile-security | Deferred | Native secure credential storage and device-loss handling before mobile delivery. A rooted device still affects the threat model. |

## SEC-034

Source: [Admin dashboard](security-video-subs/2026-08-30-an-admin-dashboard-with-no-authentication.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authorization | Candidate | Check admin page rendering, reads, writes, and actions for explicit server-side privileges. |
| 02 | abuse-controls | Candidate | Inspect admin authentication abuse controls. |
| 03 | authorization | Not applicable | Moving /admin to an obscure path does not establish access control and is not a reason to rename WerkFlow routes. |
| 04 | auditability | Candidate | Record privileged access and mutations with actor, target, time, outcome, and restricted retention. |

## SEC-035

Source: [Third-party scripts](security-video-subs/2026-08-31-a-third-party-widget-that-reads-every-keystroke.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | browser-security | Candidate | Inventory analytics, chat, review, retargeting, and experiment scripts plus the pages and data each can reach. |
| 02 | data-minimization | Candidate | Evaluate excluding unnecessary scripts from login, settings, personnel, admin, and payment pages where applicable. |
| 03 | browser-security | Candidate | Validate CSP against required scripts and inline execution while preserving streaming behavior. |
| 04 | evidence-quality | Verify | Third-party JavaScript does not read HttpOnly cookies directly; CSP allowlisting does not sandbox the privileges of an allowed script. Preserve that distinction. |

## SEC-036

Source: [Upload attacks](security-video-subs/2026-08-31-attacking-a-file-upload-form.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | upload-security | Candidate | Check extension, declared MIME, and actual content independently; test disguised files and server-side processing paths. |
| 02 | upload-security | Candidate | Restrict supported types and use controlled object names instead of trusting submitted paths. |
| 03 | upload-security | Candidate | Verify private R2 access, download headers, direct-link handling, and that uploads cannot execute as server code. |
| 04 | incident-response | Candidate | If a real compromise is found, restoring trust requires investigation beyond patching one route; the video's backdoor example is a reminder, not evidence of compromise. |
| 05 | evidence-quality | Verify | A renamed JavaScript file does not automatically become a server shell on an object store. Confirm actual execution/content-sniffing boundaries before claiming that chain applies. |

## SEC-037

Source: [OAuth redirects](security-video-subs/2026-09-01-an-oauth-redirect-left-wide-open.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authentication | Candidate | Inventory callback and redirect allowlists, including preview environments, password recovery, and caller-controlled return destinations. |
| 02 | authentication | Candidate | Verify flow binding and anti-forgery with the auth provider's supported state/PKCE/nonce mechanisms rather than inventing a second login implementation. |
| 03 | authentication | Candidate | Inspect requested OAuth scopes for least privilege if integrations are enabled. |
| 04 | evidence-quality | Verify | Confirm actual enabled OAuth providers and current provider callback rules before treating the Google example as an installed feature. |

## SEC-038

Source: [Deployment interrogation](security-video-subs/2026-09-03-a-deployment-security-interrogation.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authorization | Candidate | Cross-user UID access checks. |
| 02 | authentication | Candidate | Reset expiry and single-use behavior; 30 minutes is an example, not an accepted target. |
| 03 | input-validation | Verify | Sanitizing every field does not by itself prevent SQL injection and XSS. Trace actual query and rendering sinks. |
| 04 | browser-security | Verify | Serving only browser-originated requests does not prove an API is private. Check authentication independently of CORS. |
| 05 | abuse-controls | Candidate | Actual server/provider throttles. |
| 06 | error-disclosure | Candidate | Helpful safe error states, not just custom error screens. |
| 07 | performance | Deferred | Reconsidered 2026-09-12. Server pagination changes filtered/counting query shapes but adds no indexes. Local SQL verifies access and completeness; it does not establish index efficiency at every scale. Revisit representative safe SELECT plans when query timing or a larger workload exposes cost, before proposing indexes and their write/storage overhead. |
| 08 | observability | Candidate | Useful logs and actionable critical alerts. |
| 09 | recovery | Candidate | Verify application rollback and database compatibility. Blue-green is an example, not a required Vercel migration. |

## SEC-039

Source: [Twenty checks](security-video-subs/2026-09-05-twenty-security-checks-back-to-back.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | secrets | Candidate | API-key exposure. |
| 02 | database-security | Candidate | RLS on relevant tables. |
| 03 | authorization | Candidate | IDOR testing, transcribed as IDR. |
| 04 | secrets | Candidate | Git secret scanning. |
| 05 | auditability | Candidate | Admin-route logging. |
| 06 | tenant-isolation | Candidate | User and organization isolation tests. |
| 07 | abuse-controls | Candidate | API rate limits. |
| 08 | upload-security | Verify | "Log storage buckets" is ambiguous transcription; consider both access controls and storage audit evidence, verify original wording if it changes a decision. |
| 09 | input-validation | Candidate | Input boundary validation. |
| 10 | authentication | Candidate | Anonymous access to protected routes. |
| 11 | injection | Candidate | SQL-injection checks. |
| 12 | observability | Candidate | Sensitive-data log removal/redaction. |
| 13 | abuse-controls | Verify | "Field hammering" is ambiguous; preserve as repeated-input/endpoint abuse question until clarified. |
| 14 | upload-security | Candidate | File restrictions. |
| 15 | authorization | Candidate | Server-side business logic protection. |
| 16 | data-minimization | Candidate | Narrow response fields. |
| 17 | session-security | Verify | "Off sessions" likely refers to auth sessions; inspect session security, retain transcription uncertainty. |
| 18 | dependency-security | Candidate | Dependency scanning. |
| 19 | authorization | Candidate | Record-level authorization. |
| 20 | security-tests | Candidate | Bounded adversarial testing against authorized test environments. |

## SEC-040

Source: [Password hashing](security-video-subs/2026-09-06-password-hashing-explained.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authentication | Candidate | Verify passwords remain owned by the auth provider and are not copied into app tables, logs, or test reports. |
| 02 | cryptography | Verify | One-way hashing alone is not a complete password-storage design; verify current salted, work-factor-aware provider behavior rather than implementing custom crypto. |
| 03 | incident-response | Candidate | Credential reuse makes password disclosure affect other services. If verified exposure occurs, include revocation/reset and communication in response. |
| 04 | evidence-quality | Not applicable | Lawsuit rhetoric and blanket impossibility of recovering passwords are not technical guarantees; weak passwords can still be guessed against hashes. |

## SEC-041

Source: [Client-controlled checkout prices](security-video-subs/2026-09-02-a-checkout-price-the-client-can-set.txt)

Reviewed on 2026-09-06 for Step 1 planning. These are conditional payment-design inputs, not evidence that WerkFlow currently exposes a Stripe checkout.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | business-integrity | Deferred | When payments enter scope, derive chargeable products and amounts from authorized server data rather than trusting a submitted amount. The one-dollar example illustrates value tampering. |
| 02 | authorization | Deferred | A client product or Price ID still needs server validation against the allowed catalog, customer, and purchase. Moving session creation to the server alone does not establish this boundary. |
| 03 | payments | Verify | Confirm current Stripe Price/session semantics before adopting the claim that no application code can override pricing. Choosing another price, quantity, discount, or currency can still alter a transaction. |
| 04 | webhooks | Deferred | Before paid access exists, verify authenticated provider events and expected transaction details before granting access. A browser redirect or manually opened success page is not evidence of payment. |
| 05 | business-integrity | Deferred | Reconcile webhook confirmation with the existing duplicate/replay considerations in SEC-028.02; price integrity and event idempotence remain separate aspects. |

## SEC-042

Source: [Production errors exposing schema](security-video-subs/2026-09-02-production-errors-that-reveal-your-schema.txt)

Reviewed on 2026-09-06 for Step 1 planning. This adds concrete error-path cases to SEC-014 rather than replacing its redaction caveats.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | error-disclosure | Candidate | Exercise broken URLs and failing reads/writes for exposed database names, queries, table structure, server paths, ORM identity, package versions, and stack traces. Distinguish sensitive data from harmless public implementation metadata when prioritizing findings. |
| 02 | deployment-security | Candidate | Check actual development, preview, and production error behavior. A development flag must not expose customer data in a reachable preview or developer environment. |
| 03 | observability | Candidate | Capture safe structured error context, time, and correlation identifiers in restricted monitoring while preserving useful public recovery guidance. |
| 04 | data-minimization | Not applicable | Logging the complete user session and every request context without redaction would create another exposure. Define which fields are necessary and exclude tokens, credentials, and sensitive personal data. |
| 05 | interaction-feedback | Candidate | Verify 404, server failure, and timeout experiences provide a clear next action and retain recoverable work. A branded page that reveals nothing useful to the user is not sufficient. |
| 06 | security-tests | Candidate | Match safe-error checks to public response bodies and actual browser output, not just one shared error component; different server boundaries can bypass it. |

## SEC-043

Source: [IDs supplied in API requests](security-video-subs/2026-09-03-an-api-that-trusts-the-id-in-the-url.txt)

Reviewed on 2026-09-06 for Step 1 planning. This extends the input-location inventory for SEC-004 and SEC-039.19.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | authorization | Candidate | Inventory identifiers accepted through route paths, query strings, and request bodies. Derive actor identity from verified authentication rather than a submitted user ID. |
| 02 | tenant-isolation | Candidate | Test record access across organizations and between roles/assignments within an organization. A legitimate manager may access another employee's authorized records, so equality with a record owner is not the complete SHK rule. |
| 03 | authorization | Not applicable | Replacing every sequential identifier with a UUID does not repair missing authorization and would create unnecessary migration work without an independent requirement. |
| 04 | abuse-controls | Candidate | Consider identifier enumeration and bulk extraction even when identifiers are unpredictable; authorization and request-volume controls serve different purposes. |
| 05 | api-contracts | Verify | A universal 403 response or ownership middleware is not automatically appropriate. Preserve the app's chosen disclosure behavior and enforce permissions at the actual action/data boundary. |

## SEC-044

Source: [Credentials in browser bundles](security-video-subs/2026-09-03-database-credentials-in-the-client-bundle.txt)

Reviewed on 2026-09-06 for Step 1 planning. The concrete additions are public-build inspection and a distinction between import protection and serialized-data exposure.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | secrets | Candidate | Inventory credential-bearing modules, their imports/exports, and actual client entry points. Inspect whether sensitive values cross into browser-delivered modules or serialized props/action results. |
| 02 | supply-chain | Candidate | Evaluate build-time server-only module guards as prevention for accidental client imports, using the installed framework's supported conventions. |
| 03 | architecture | Verify | A correctly declared Server Action is not inherently shipped as server implementation code to the browser. Verify the specific framework import/export behavior before accepting the video's causal explanation. |
| 04 | security-tests | Candidate | Inspect the public files delivered by a production build and deployed responses for server-only secrets. Report locations and redacted evidence without printing secret values into test or review logs. |
| 05 | data-minimization | Verify | Database hostnames and intentionally public environment values are not all credentials; a match anywhere in server-side build output does not prove browser exposure. Classify the value and the delivered artifact. |
| 06 | evidence-quality | Not applicable | A successful build after adding server-only does not prove secrets are absent from rendered data, logs, responses, public environment variables, or other files. Import protection and secret scanning need separate evidence. |
| 07 | maintainability | Candidate | Keep actual server/client ownership clear without mechanically moving every function to another file or forbidding supported Server Action references. Fix proven boundary risks and preserve current architecture. |

## SEC-045

Source: [Tokens in browser storage](security-video-subs/2026-09-04-an-auth-token-left-in-localstorage.txt)

Reviewed on 2026-09-06 for Step 1 planning. These overlap SEC-006 and SEC-015 but add explicit revocation-list/token-version options for evaluation.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | session-security | Candidate | Inspect actual access/refresh-token storage and which same-origin scripts can read it, including any third-party widget. Do not infer this repository uses localStorage from the video. |
| 02 | authentication | Verify | HttpOnly cookies can limit script reads, but adopting them must fit the actual auth and browser Realtime architecture. Check current provider-supported handling before changing token ownership or inventing a second session system. |
| 03 | browser-security | Candidate | Evaluate Secure/SameSite, cookie scope, CSRF defenses, and script restrictions together. HttpOnly does not prevent an injected script from issuing authenticated requests in the victim's browser. |
| 04 | session-security | Candidate | Review access expiry, refresh-token rotation/reuse behavior, and lost-device risk together. Fifteen minutes and thirty days are examples, not accepted policy. |
| 05 | session-security | Candidate | Establish password-change, compromise, offboarding, and role-change revocation behavior with an explicit maximum surviving access window and tests. |
| 06 | architecture | Deferred | A custom revocation list or token-version scheme is a possible response only if provider behavior cannot meet an agreed requirement; account for every API, database, and Realtime consumer before adoption. |
| 07 | evidence-quality | Verify | Cookies do not travel on every request regardless of origin/path/attributes, and immediate token death is not guaranteed by changing a password or storing a server-side version alone. Verify actual enforcement paths. |

## SEC-046

Source: [Privileged cloud functions](security-video-subs/2026-09-05-cloud-functions-running-with-admin-privileges.txt)

Reviewed on 2026-09-06 for Step 1 planning. Firebase is the example platform; the audit question is the privilege gap in WerkFlow's actual trusted server/database operations.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | database-security | Candidate | Inventory privileged clients/functions, the access rules they bypass, and why elevated access is required. A server execution environment does not itself restrict access to the caller's permitted records. |
| 02 | input-validation | Candidate | Validate types, allowed values, identifiers, and unexpected fields before privileged queries. Examine caller-selected table/collection/resource names separately from ordinary data values. |
| 03 | authorization | Candidate | Derive trusted actor/organization context and enforce actual role, assignment, personnel, and record permissions before elevated reads or writes. Literal owner-only filtering would break intentional shared-business access. |
| 04 | security-tests | Candidate | For each privileged path, compare reachable data/effects with permitted data/effects and test direct calls using unauthorized actors or identifiers. Validation alone does not prove authorization. |
| 05 | evidence-quality | Not applicable | The app does not gain a Firebase Cloud Functions requirement from this source, and blanket statements that server functions have no rules must be checked against actual runtime and database privileges. |

## SEC-047

Source: [Mass assignment and review limits](security-video-subs/2026-09-06-mass-assignment-a-code-review-will-not-catch.txt)

Reviewed on 2026-09-06 for Step 1 planning. This makes the earlier mass-assignment checklist item SEC-024.15 concrete without assuming a defect exists.

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | input-validation | Candidate | Inventory write handlers that spread or pass submitted objects into database updates. Explicitly define writable fields by operation and actor; test omitted, extra, and protected fields. |
| 02 | authorization | Candidate | Treat role, permissions, account/employment state, organization, and future plan/entitlement fields as explicit privilege decisions. The video's name/email/avatar examples still need their own identity and verification rules. |
| 03 | architecture | Candidate | Separate ordinary and elevated operations through precise contracts and authorization. Separate URLs can help but are not mandatory if one existing boundary safely enforces distinct operations; avoid duplicate endpoints solely to match the video. |
| 04 | security-tests | Candidate | Send prohibited fields directly, bypassing the normal form, and verify rejection or removal plus unchanged protected database state. A successful status code or sanitized response alone cannot prove no forbidden write occurred. |
| 05 | security-tests | Candidate | Treat clean CodeRabbit/static review as complementary evidence, not proof of complete runtime authorization or business-logic coverage. Preserve negative integration tests for actual critical write boundaries. |
| 06 | evidence-quality | Verify | The categorical claim that CodeRabbit cannot catch mass assignment or inspect an attack boundary is not established. Its capabilities and a specific scan result need direct evidence; false negatives remain possible for any reviewer. |
