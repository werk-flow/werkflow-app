# Security control map

Status: living — last reviewed 2026-10-28

## How to work

### Add a table

1. Copy `supabase/migrations/20261001104036_limit_organization_join_attempts.sql`: RLS enabled, a full revoke, then exactly the grants the code uses. Follow [the migration rule](environments.md#the-migration-rule). The table carries `organization_id` or joins the global-table list in `supabase/tests/security_boundaries.sql`.
2. Start from server-only access: the migration grants `service_role` only. A client read grant comes with the policy that limits it, and a client write joins the reviewed inventory.
3. A table that feeds the period calculation gets the closed-period trigger. A ledger refuses UPDATE and DELETE, and `supabase/tests/security_boundaries.sql` asserts the denial.
4. A table the UI shows live follows [add Realtime data](realtime-and-caching.md#add-realtime-data).
5. Every service-role query on the table filters by `organization_id` or carries a reviewed `tenant-scope:` comment.
6. Run `bun run test:verify --group sql:security`, `bun run migrations:check`, `bun run types:check` and `bun run test:unit lib/conventions/tenant-scope.test.ts`.

Wrong turn: a policy that checks membership but not the role. Every member can then read through the Data API what the UI shows only to managers.

### Add a Server Action or route handler

1. Put the action in its domain's `'use server'` module, and export only actions. A helper that needs the admin client or a trusted user id lives in a `server-only` module. A module a Bun script imports (`lib/storage/r2.ts`) cannot import `server-only`, which throws outside Next; the storage import boundary test keeps it out of browser bundles.
2. Parse every parameter with a schema before its first use. An id goes through `uuidSchema`.
3. Establish the caller through `lib/org/action-context.ts`: `resolveActionContext` for the active organization, `resolveActionContextFor` for an organization taken from a parsed argument or a loaded row, `lib/org/self-service-context.ts` for a person's own records, or a wrapper named in `lib/security/server-action-authorization.test.ts`. Check its failure before the first admin call or write. Take the user, organization and role from it. An action without an organization joins the test's identity-only list with a reason.
4. Check the role. Then load the target inside the caller's organization and check object permission and lifecycle.
5. An operation that sends mail, redeems a capability or activates billing calls `consumeRateLimit` from `lib/security/rate-limit.ts` before it acts.
6. Write. Rows that change together change in one database function call ([write related rows](code-quality.md#write-related-rows)). Return `ActionResult` with a stable code, and log a failure through `logError`.
7. A route handler gets its entry in `lib/security/route-inventory.test.ts`. A handler that sets cookies or redeems a capability from a request body calls `verifySameOriginJsonRequest` first. A GET handler redeems nothing from a query string.
8. Write the boundary test: copy `lib/testing/fixtures/join-request-boundaries.ts`, which runs the real actions on `action-boundary-world.ts`, and expect a refusal for a foreign organization's id and for a lower role.
9. Run `bun run test:unit lib/security lib/conventions/server-action-input.test.ts` and the new boundary test.

Wrong turn: trusting an id because the UI offers only the caller's own records. Every export is a public POST endpoint, and anyone can send any id.

### Add a privileged function

1. Write a `SECURITY DEFINER` function only when one transaction must cross RLS, such as an approval that creates a membership. A function that writes related rows for a server action runs as `security invoker`.
2. A new function starts closed; grant execution to `service_role`. An RLS helper that policies call goes into `app_private` instead, and joins the definer-execution inventory with the policy that needs it.
3. Resolve the organization and the role in the server caller before it calls the function.
4. Run `bun run test:verify --group sql:security` and the SQL group that owns the function.

Wrong turn: granting `authenticated` so the browser can call the function; it then runs with its owner's rights past every policy.

### Add a storage path

1. Build the key with the owning organization id as its first segment, and read and write only through `lib/storage/r2.ts`.
2. Authorize the target on the server, then sign a short-lived URL. The browser moves the bytes. [Document storage and access](document-storage-and-access.md) owns the access classes.
3. Run `bun run test:unit lib/storage lib/security/storage-import-boundary.test.ts`.

Wrong turn: bytes through a Server Action.

### Log a failure

1. Call `logError('<function>: <what failed>', error)` from `lib/logging.ts`. It keeps only the error's name, code and status.
2. Keep the label free of recipients, codes, links, row values and provider bodies.
3. Run `bun run lint <files>`.

Wrong turn: `console.error(error)`; a provider message can quote row values.

## Trust boundaries

| Boundary | Invariant | Mechanism and check |
| --- | --- | --- |
| Route handlers | Each handler authenticates the caller itself or delegates to an action that does. A handler that writes cookies or redeems a capability from a request body accepts only a same-origin JSON request. A GET redeems an invite only right after a code exchange in the same request, so a signed-in invitee accepts with one click on the login page. No URL carries a provider message or a person's email address; the next step reads the address from an httpOnly cookie scoped to its page (`lib/auth/address-cookies.ts`), the invite row, or the session. | `lib/security/route-inventory.test.ts` holds one reviewed entry per handler and fails on a handler without one. `lib/security/email-in-url.test.ts` fails on product code that writes or reads an `email` query parameter. `lib/security/same-origin.ts` owns the origin check. `lib/security/redeem-invite-http.test.ts` and `lib/security/auth-callback-http.test.ts` drive the invite handlers. |
| Server Actions | Every export of a `'use server'` module is a public POST endpoint. It parses its input, then establishes identity, organization, role, lifecycle and object permission on the server before a protected operation. | `lib/security/server-action-authorization.test.ts` requires an unconditional owner-function call whose failure is checked before the first admin call or write, and rejects unsupported and unused exports. Boundary tests prove the permission. `lib/conventions/server-action-input.test.ts` requires a schema parse before first use. |
| Page routing | `proxy.ts` sends a visitor without a session away from every authenticated area. `app/(app)/layout.tsx` checks the session again and is the authority. When Auth is unavailable the proxy lets the request through, and the layout shows the error page. The proxy and the server identity check classify an Auth failure through the same module. | `lib/auth/identity-errors.ts` owns the classification. `lib/security/proxy-prefixes.test.ts` derives the protected prefixes from the `app/(app)` folders. `lib/security/proxy-session.test.ts` covers the missing, rejected and unavailable session. |
| Redirects after login | A return destination is a same-origin path. An invite code is a UUID before the app echoes it. | `lib/auth/return-path.ts` and its unit tests. |
| Organization context | The active-organization cookie is a hint. The server accepts it only when the caller is a current member, and refuses to set it for a non-member. | `selectActiveMembership` in `lib/org/action-context.ts`, `lib/org/active-cookie.test.ts`, `lib/data/membership-freshness.test.ts`. |
| Joining an organization | Join codes come from the cryptographic random source. A code creates a join request, never a membership. Only an Admin or Büro approval in that organization creates the membership, in one database function. A signed-in user gets a limited number of failed join attempts per hour. | `lib/org/join-request-actions.ts`, `lib/org/join-limit.test.ts`, `lib/org/join-request-actions.test.ts`, `sql:join-requests`. |
| Database | RLS restricts every client read, by role and assignment where the server readers restrict them. Client roles write no table directly, except a user's own name and avatar. Nothing is granted to `anon`. A write policy exists only where a client write grant needs it. Ledger tables refuse direct UPDATE and DELETE, also for privileged roles. | `sql:security` runs `supabase/tests/security_boundaries.sql` and `supabase/tests/client_read_boundaries.sql`. Its inventories of anonymous grants, client writes and definer functions carry a reason per entry. `canary:security` checks the live DEV grants. |
| Service-role queries | The admin client bypasses RLS. A query on a table with an `organization_id` column filters by the organization or carries a reviewed `tenant-scope` reason. | `lib/conventions/tenant-scope.test.ts`. It treats a client it cannot prove to be the caller's RLS client as privileged, and fails on an annotation that excuses no query. |
| Closed time periods | A closed period freezes the recorded time of its month for every writer, including service-role code. Close refuses with `period_open_sessions` while a session that began before the period end is still open. | Database triggers raise SQLSTATE `WFP01`. `isPeriodClosedError` in `lib/time-tracking/closed-periods.ts` maps it to `period_closed`. `sql:closed-period-writes` runs `supabase/tests/closed_period_writes.sql`. |
| Abuse limits | Invite mail, invite redemption, email-change codes, the simulated payment and health checks pass a limit per subject. A limiter that cannot decide refuses the operation; the health check proceeds. A subject reaches the database only as a keyed hash. | `lib/security/rate-limit.ts`, `lib/security/rate-limit.test.ts`, `lib/security/rate-limit-inventory.test.ts`, `sql:rate-limits`. |
| Cross-organization writes | A write that names another record (a job, a person, an entry) checks that the record belongs to the caller's organization and, where it applies, to the same person. | The owning action plus a boundary test that drives the real action with a foreign id, for example `lib/testing/fixtures/join-request-boundaries.ts`. |
| Realtime | One channel per organization. RLS governs INSERT and UPDATE delivery, so a person waiting on a join request receives only their own request. Raw DELETE and TRUNCATE publication is off. Database triggers write minimal deletion notices that only current members receive. Consumers treat an event as a signal and read again through an authorized reader. | `bun run realtime:check`, the Realtime assertions in `sql:security`, and `canary:security` for foreign and removed receivers. [Realtime and caching](realtime-and-caching.md) owns the transport. |
| Files | Bytes live in private buckets. Server code authorizes the target, builds the storage key and signs a short-lived URL. Finalization checks size and existence again. Every storage key starts with the owning organization id. The storage adapter and the admin client never reach the browser, and a Server Action never receives file bytes. | `assertOrganizationStorageKey` in `lib/storage/r2.ts` with `lib/storage/r2.test.ts`, `lib/documents/upload-targets.test.ts`, `lib/security/storage-import-boundary.test.ts`. [Document storage and access](document-storage-and-access.md) owns the access classes. |
| Email change | One service-only RPC serializes every challenge transition per account. Send windows per mailbox survive a reset of the wizard. A completion claim permits one Auth update. Client roles cannot read either state table. | `supabase/tests/email_change_boundaries.sql`, `lib/security/account-boundaries.test.ts`. |
| Mail | The edge functions accept only the project's secret keys and escape every interpolated value. The email-change code is stored as a keyed hash over user id and code. Missing configuration and provider failure return a failure. Logs hold fixed error codes and status numbers, never recipients, codes, invitation links or provider bodies. | `supabase/functions/_shared/`, `lib/settings/otp-hash.ts`, `lib/security/mail-handlers.test.ts`. |
| Browser | Responses carry the hardening headers and the enforced Content-Security-Policy from `buildSecurityHeaders` in `next.config.ts`. The script policy allows the app's own origin and inline scripts. Violations go to `POST /api/csp-report`, which is unauthenticated by design, stores nothing and logs a redacted summary. An `eval` report, or one that names another origin, is a finding. Product code has no HTML string sink and no `eval`. | `lib/security/headers.test.ts` calls the real builder. `lib/security/csp-report.test.ts` pins the directives. The `htmlSinkSelectors` lint set rejects the sinks. |
| Dependencies | Every plan carries an advisory check under 24 hours old. An unknown finding, a changed applicability input, an expired exception and an exception that matches no current finding fail. | `bun run security:dependencies` (`static:dependencies`). Reviewed exceptions live in `lib/security/dependency-exceptions.json`. |

## Checklist

The tag names the mechanism that fails on a violation. A `[judgment]` item here is a hard rule that review enforces, not a default. Only the two Tier 3 defaults of virtue 3 in `AGENTS.md` admit a recorded divergence.

- Every export of a `'use server'` module calls an owner function of `lib/org/action-context.ts` or `lib/org/self-service-context.ts`, a named wrapper or a reviewed identity-only function, unconditionally, and checks its failure before the first admin call or write. A helper that needs the admin client or a trusted user id lives in a `server-only` module. [code `lib/org/action-context.ts`, test `lib/security/server-action-authorization.test.ts`]
- Every parameter of an exported Server Action, inline ones included, goes through a Zod schema parse or a named validator before its first use. [test `lib/conventions/server-action-input.test.ts`]
- Role, lifecycle and object permission are the right ones for the operation. [judgment]
- Every exported Server Action has a boundary fixture that asserts its refusal of a foreign id or a lower role, unless it is self-scoped and the test proves it takes no id; the `missing` list only shrinks. [test `lib/security/boundary-coverage.test.ts`]
- A service-role query or function call on organization data passes an organization derived from the resolved context, or carries a reviewed `tenant-scope` reason. [test `lib/conventions/tenant-scope.test.ts`]
- A route handler calls the authorization its reviewed entry names, and no response body or redirect URL carries an error's message or details. [test `lib/security/route-inventory.test.ts`, test `lib/security/health-http.test.ts`]
- A handler that sets cookies or redeems a capability from a request body calls `verifySameOriginJsonRequest`. [test `lib/security/same-origin.test.ts`, test `lib/security/redeem-invite-http.test.ts`]
- A new authenticated route area is routed by `proxy.ts`. [test `lib/security/proxy-prefixes.test.ts`]
- An identity check that cannot complete is a failure, never a signed-out caller and never access. A page shows the error page, a route handler answers with a private 500 or 503, the auth callback sends the person to the `/auth/unavailable` screen, and the proxy lets the request through. [test `lib/security/proxy-session.test.ts`, test `lib/data/background-read-http.test.ts`, test `lib/security/auth-callback-http.test.ts`, test `lib/security/redeem-invite-http.test.ts`]
- The migration that creates a table enables RLS, adds the policies its client access needs, revokes everything from `public`, `anon`, `authenticated` and `service_role`, and grants exactly the needed operations to exactly the needed roles. The migration role's default grants are revoked for tables and functions, so a new object has no Data API access until its migration grants it. A client grant without a policy for its command fails, and a client write joins the reviewed inventory. Grant to `anon` never without the owner's approval. Grant sequence privileges when an intended insert needs them: the service role bypasses RLS, not SQL privileges. [group `sql:security`, group `canary:security`]
- A SELECT policy applies the role and assignment limits of the server readers. `supabase/tests/client_read_boundaries.sql` proves that an employee reads only their own jobs, assignments and projects, and a suspended member nothing; extend it for a new role-limited table. [group `sql:security`, test `supabase/tests/client_read_boundaries.sql`]
- RLS checks effective personnel access wherever a policy or its helper reads `organization_members`, `job_assignments` or `employee_records`. [group `sql:security`]
- A public function is executable by `service_role` only. An RLS helper that client roles must execute lives in `app_private`, is granted to `authenticated` only, and joins the definer-execution inventory in `supabase/tests/security_boundaries.sql` with the policy that needs it. [group `sql:security`]
- A new table that feeds the period calculation gets the closed-period trigger. [group `sql:closed-period-writes`]
- A new ledger table refuses direct rewriting, also by privileged roles, with a real denial and a permitted-cleanup assertion. Cascade or reference-nulling follows the domain's retention rule. [group `sql:security`]
- A service-only list or search function revokes browser execution, and its server caller resolves organization and role before it uses the admin client. [group `sql:list-pagination`, group `sql:planning-options`]
- A schema change follows [the migration rule](environments.md#the-migration-rule). [script `migrations:check`, script `types:check`, test `lib/security/destructive-migrations.test.ts`, test `lib/security/retired-functions.test.ts`]
- Every public table carries `organization_id` or sits in the reviewed global-table list. [group `sql:security`]
- DEV's Auth configuration matches the reviewed posture, and its advisors report nothing outside the reviewed exceptions. [test `lib/security/supabase-project-checks.test.ts`, script `auth:check`, script `advisors:check`]
- Every storage key starts with the owning organization id and goes through the storage adapter. [code `lib/storage/r2.ts`, test `lib/storage/r2.test.ts`]
- The storage adapter and the admin client never reach a browser bundle. A Server Action never takes file bytes, and only the reviewed writers store a server-generated file. [test `lib/security/storage-import-boundary.test.ts`]
- A redirect destination from a query string goes through `resolveSafeReturnPath`. [test `lib/auth/return-path.test.ts`]
- A person's email address never travels in a URL. [test `lib/security/email-in-url.test.ts`]
- The active-organization cookie counts only for a current member. [test `lib/org/active-cookie.test.ts`, test `lib/data/membership-freshness.test.ts`]
- A GET handler that shares identity reads follows [read-request authorization reuse](#read-request-authorization-reuse). [test `lib/data/read-request-cache.test.ts`]
- A provider failure returns a stable error code, and its log holds no recipient, code, link or provider body. [test `lib/security/mail-handlers.test.ts`, test `lib/security/edge-functions.test.ts`, judgment]
- Server code logs a failure through `logError`, never through `console`. [lint `no-restricted-properties`, code `lib/logging.ts`]
- A reader cached across requests throws `CachedReadError` on a failed read, so the cache never keeps a failure. [code `lib/data/cached-read-failure.ts`, test `lib/data/cached-read-failures.test.ts`]
- An edge-function mail send, an invite redemption or a billing write follows a checked `consumeRateLimit` verdict. [test `lib/security/rate-limit-inventory.test.ts`, test `lib/security/rate-limit.test.ts`, group `sql:rate-limits`]
- Account and email-change transitions stay atomic and server-only. [test `lib/security/account-boundaries.test.ts`]
- Responses keep the hardening headers and the enforced Content-Security-Policy. [test `lib/security/headers.test.ts`, test `lib/security/csp-report.test.ts`]
- Product code imports Zod through `lib/zod.ts`, which turns off its `eval` probe. [code `lib/zod.ts`, test `lib/conventions/zod-entry.test.ts`]
- Every plan carries an advisory pass under 24 hours old; an exception names its path, reason, digest and expiry. [group `static:dependencies`, test `lib/security/dependency-audit.test.ts`]
- A workflow pins each outside action to a commit SHA and its release. [test `lib/security/workflow-actions.test.ts`]
- Live DEV grants and Realtime delivery to foreign and removed receivers pass before a release. [group `canary:security`]
- Every residual exposure the owner accepted is listed below until it closes. [judgment]

## Never

- Restrict an operation only in the UI. [judgment]
- Client-sent identity: an id, organization or role (`AGENTS.md`, virtue 3). [judgment]
- Export a helper from a `'use server'` module. [test `lib/security/server-action-authorization.test.ts`]
- Grant to `anon`, or leave a table without RLS or a client grant without a policy. [group `sql:security`]
- Call `signOut()` without an explicit scope. [lint `authSelectors`]
- Write the production project ref outside `scripts/`. [lint `prodRefSelectors`]
- Render a string as HTML or evaluate it as code. [lint `htmlSinkSelectors`, test `lib/security/html-sink-lint.test.mjs`]
- Log personal data, codes, provider bodies or a raw error object. [lint `no-restricted-properties`, test `lib/security/mail-handlers.test.ts`, judgment]
- Cache a permission fact across requests, or an authenticated response at the CDN. [test `lib/data/membership-freshness.test.ts`, judgment]
- Add a retry or a cookie fallback that turns a failed identity check into access. [test `lib/security/proxy-session.test.ts`]
- Write to PROD outside a release the owner requested. [judgment]

## Verify your work

1. Run `bun run test:unit`.
2. For a migration, a policy or a privileged function, run `bun run test:verify --group sql:security` on the local stack, plus the SQL group that owns the touched table or function, such as `sql:closed-period-writes` or `sql:list-pagination`. Then run `bun run migrations:check` and `bun run types:check`.
3. For a dependency change, run `bun run security:dependencies`. A network failure leaves it unverified, not passed.
4. Before a release, the cloud canary runs `canary:security` against DEV (`bun run test:verify --target cloud`).
5. Record the Tier 3 answers in the slice record, or in the commit message outside a slice: which permission check guards each new operation and why it is the right one, and every residual exposure with the owner's acceptance.

## Known residual exposure

- Injected inline scripts are not blocked. The enforced script policy allows `'unsafe-inline'`, so it stops foreign scripts but not an injected inline one. A nonce per request needs every page rendered per request, which `cacheComponents` rules out. The `htmlSinkSelectors` lint set keeps product code from creating such an injection point. Cached rendering stays.
- No edge rate limit covers every request. The application limits the operations that send mail, redeem a capability or activate billing, and Supabase Auth limits its own endpoints. Edge limiting is the owner's Vercel plan decision.
- The deletion transport lets current members of an organization receive the identity of a deleted row. It carries no record content.
- `simulatePayment` in `lib/subscription/actions.ts` lets a signed-in user without an organization activate a subscription for their own account, once. It is the beta activation path and closes with the payment slice.
- The code step keeps the address for up to one hour in an httpOnly cookie scoped to `/verify` in the browser that signed up or signed in.
- The `health` edge function has no rate limit; its constant-time 64-hex token bounds it.
- Member removal refuses a target with recorded time. `P1-33` owns complete offboarding and asset return.
- Two provider facts are unverified: the R2 buckets' CORS rules (runtime tokens get `AccessDenied` on `GetBucketCors`; a check needs an R2 token with Admin Read) and the Vercel environment scopes (a check needs a Vercel token that reads the project's environment).

## Revocation boundaries

| Consumer | Enforcement and limit |
| --- | --- |
| Privileged server reads and actions | Verified identity plus current membership, role, object and lifecycle rules. The server loads them again on each request and render. Scheduled restrictions are evaluated at read time. |
| Direct database clients | RLS consults current membership and effective personnel access. A valid JWT alone grants no organization access. |
| Realtime | INSERT and UPDATE use the table's current RLS. Deletion notices use the protected transport. Freshness inside one organization is not evidence of tenant denial. |
| Signed file URLs already issued | A URL is a bearer capability. Revocation prevents new signing; an issued URL stays valid until it expires, and a downloaded file cannot be recalled. |
| Auth sessions | [Supabase sign-out](https://supabase.com/docs/guides/auth/signout) lets an issued access token stay valid until it expires. Suspend operational access during an incident and follow the [runbook](recovery-and-incidents.md). |

## Sensitive-data handling and owner decisions

| Data | Purpose and access | Retention responsibility |
| --- | --- | --- |
| Customer contacts, sites, work records, signatures | Organization operations. Roles and assignments restrict reads and writes. | Preserve business history and the explicit trash and version behavior. The owner sets contractual retention and deletion rules before client data is imported. Add no guessed automatic deletion period. |
| Personnel, sickness, time, payroll exports | Employment operations. Personnel access classes and explicit releases are separate from the document library. An export is a copy outside the app's access control. | The owner decides lawful purpose, recipients and retention with appropriate advice. Ending access does not authorize deleting employment or time history. |
| Mail | Invitations and code delivery. These handlers send no business documents. | The provider's mail metadata has its own lifecycle. |
| Logs, traces, test artifacts | Diagnosis and test evidence. Test fixtures are synthetic. | Limit access and remove secrets from exported evidence. Ignored files are neither encrypted nor purged automatically. |
| Backups and retained file versions | Recovery. Database backups hold no file bytes. | [The runbook](recovery-and-incidents.md) records backup coverage and accepted loss. Deleting a live record does not erase a retained backup. |

Provider data-processing agreements: [Supabase](https://supabase.com/legal/customer-resources/data-processing-addendum), [Vercel](https://vercel.com/legal/dpa), [Cloudflare](https://www.cloudflare.com/cloudflare-customer-dpa/), [Resend](https://resend.com/legal/dpa). Before sensitive client data is imported, the owner retains the applicable agreements, defines responsibilities and retention, and confirms the provider setup. EU locations alone do not establish GDPR compliance. Product analytics or session replay needs the owner's privacy and cost decision before it is added.

## Read-request authorization reuse

A GET handler may share the identity and membership reads of one request through `lib/data/read-request-cache.ts`. The rules:

- Each GET receives a fresh scope; no identity or membership result crosses requests.
- Never wrap a Server Action or a mutation, and never pass caller-supplied authorization context into a `'use server'` export.
- A handler that takes an organization from the request requires it to equal the resolved active organization.
- The privileged profile lookup reads through the caller's own RLS on every call.
- A new consumer extends `lib/data/read-request-cache.test.ts`, which pins the reviewed consumers. Job-access facts share one read per render or GET scope (`lib/jobs/job-access-reads.ts`) and read fresh in a Server Action.

Membership alone authorizes no retained data of a removed employee: the clock-state reads check current membership in the action itself, and `lib/time-tracking/state-http.test.ts` drives the denied identities.

## Calendar correction input boundary

A calendar gesture sends source references and proposed boundaries to the one correction action. The server loads the source facts again inside the organization, refuses a stale or partial replacement, and takes no accounting context from the client. A correction commits only while the time revision captured before validation is current. Server readers filter correction history by the effective employee. `sql:p1-22` covers client denial, stale revisions and recipient visibility.

## Examples

- `supabase/migrations/20261001104036_limit_organization_join_attempts.sql`: a new table with RLS, no client policy, a full revoke and the one grant the code uses.
- `lib/testing/fixtures/join-request-boundaries.ts`: the boundary fixture a new action module copies.
