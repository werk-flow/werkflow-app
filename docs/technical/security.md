# Security control map

Status: living — last reviewed 2026-10-04

Read this before you add a route handler, Server Action, privileged call, table, storage path or provider setting. It names each security invariant, the mechanism that enforces it, and the check that fails on a regression. [Environments](environments.md) owns project identities and provider posture. [Testing](testing.md) owns how the checks run.

## How to work

Every rule on this page is hard. Each procedure follows the order the code runs its checks.

### Add a table

1. Copy `supabase/migrations/20261001104036_limit_organization_join_attempts.sql`: RLS enabled, a full revoke, then exactly the grants the code uses. Follow [the migration rule](environments.md#the-migration-rule). An organization-owned table carries `organization_id`.
2. Start from server-only access: server code reads and writes through the admin client, the migration grants `service_role` only, and no client policy exists. Add a client grant only together with the policy that limits it.
3. A table that feeds the period calculation gets the closed-period trigger. A ledger refuses UPDATE and DELETE, and `supabase/tests/security_boundaries.sql` asserts the denial.
4. A table the UI shows live follows [add Realtime data](realtime-and-caching.md#add-realtime-data).
5. Every service-role query on the table filters by `organization_id` or carries a reviewed `tenant-scope:` comment.
6. Run `bun run test:verify --group sql:security`, `bun run migrations:check`, `bun run types:check` and `bun run test:unit lib/conventions/tenant-scope.test.ts`.

Wrong turn: a policy that checks membership but not the role. Every member can then read through the Data API what the UI shows only to managers.

### Add a Server Action or route handler

1. Put the action in its domain's `'use server'` module, and export only actions. A helper that needs the admin client or a trusted user id lives in a `server-only` module.
2. Parse every parameter with a schema before its first use. An id goes through `uuidSchema`.
3. Establish the caller through the domain's context helper, such as `resolveActionContext` in `lib/org/action-context.ts`. Take the user and the organization from it, never from an argument.
4. Check the role. Then load the target inside the caller's organization and check object permission and lifecycle.
5. An operation that sends mail, redeems a capability or activates billing consumes its limit from `lib/security/rate-limit.ts` before it acts.
6. Write. Rows that change together change in one database function call ([write related rows](code-quality.md#write-related-rows)). Return `ActionResult` with a stable code, and log a failure through `logError`.
7. A route handler gets its entry in `lib/security/route-inventory.test.ts`. A handler that sets cookies or redeems a capability from a request body calls `verifySameOriginJsonRequest` first.
8. Write the boundary test: copy `lib/testing/fixtures/join-request-boundaries.ts`, which runs the real actions on `action-boundary-world.ts`, and expect a refusal for a foreign organization's id and for a lower role.
9. Run `bun run test:unit lib/security lib/conventions/server-action-input.test.ts` and the new boundary test.

Wrong turn: trusting an id because the UI offers only the caller's own records. Every export is a public POST endpoint, and anyone can send any id.

### Add a privileged function

1. Write a `SECURITY DEFINER` function only when one transaction must cross RLS, such as an approval that creates a membership. A function that writes related rows for a server action runs as `security invoker`.
2. Revoke execution from `PUBLIC`, `anon` and `authenticated`, and grant it to `service_role`. An RLS helper that policies call goes into `app_private` instead, and joins the definer-execution inventory with the policy that needs it.
3. Resolve the organization and the role in the server caller before it calls the function.
4. Run `bun run test:verify --group sql:security` and the SQL group that owns the function.

Wrong turn: granting `authenticated` so that the browser can call the function. It then runs with its owner's rights for every signed-in user, past every policy.

### Add a storage path

1. Build the key with the owning organization id as its first segment, and read and write only through `lib/storage/r2.ts`.
2. Authorize the target on the server, then sign a short-lived URL. The browser moves the bytes. [Document storage and access](document-storage-and-access.md) owns the access classes.
3. Run `bun run test:unit lib/storage lib/security/storage-import-boundary.test.ts`.

Wrong turn: sending the bytes through a Server Action. The body limit breaks large files, and the server holds every upload in memory.

### Log a failure

1. Call `logError('<function>: <what failed>', error)` from `lib/logging.ts`. It keeps only the error's name, code and status.
2. Keep the label free of recipients, codes, links, row values and provider bodies.
3. Run `bun run lint <files>`.

Wrong turn: `console.error(error)`. A database or provider message can quote row values and email addresses.

## Trust boundaries

| Boundary | Invariant | Mechanism and check |
| --- | --- | --- |
| Route handlers | Each handler authenticates the caller itself or delegates to an action that does. A handler that writes cookies or redeems a capability from a request body accepts only a same-origin JSON request. | `lib/security/route-inventory.test.ts` holds one reviewed entry per handler and fails on a handler without one. `lib/security/same-origin.ts` owns the origin check. `lib/security/redeem-invite-http.test.ts` drives the invite handler. |
| Server Actions | Every export of a `'use server'` module is a public POST endpoint. It establishes identity, then the current role, organization, lifecycle and object permission, before a protected operation. The caller's id comes from the verified session, never from an argument. Every parameter is parsed before its first use. | `lib/security/server-action-authorization.test.ts` finds every directive, rejects unsupported exports and fails on an exported action that no product module imports. It checks that an identity helper is called. It does not prove the order or the right permission: negative boundary tests do that. `lib/conventions/server-action-input.test.ts` fails on a parameter used before validation without a reviewed reason. |
| Page routing | `proxy.ts` sends a visitor without a session away from every authenticated area. `app/(app)/layout.tsx` checks the session again and is the authority. When Auth is unavailable the proxy lets the request through, and the layout shows the error page. The proxy and the server identity check classify an Auth failure through the same module. | `lib/auth/identity-errors.ts` owns the classification. `lib/security/proxy-prefixes.test.ts` derives the protected prefixes from the `app/(app)` folders. `lib/security/proxy-session.test.ts` covers the missing, rejected and unavailable session. |
| Redirects after login | A return destination is a same-origin path. An invite code is a UUID before the app echoes it. | `lib/auth/return-path.ts` and its unit tests. |
| Organization context | The active-organization cookie is a hint. The server accepts it only when the caller is a current member, and refuses to set it for a non-member. | `lib/org/cookies.ts`, `lib/org/active-cookie.test.ts`, `lib/data/membership-freshness.test.ts`. |
| Joining an organization | Join codes come from the cryptographic random source. A code creates a join request, never a membership. Only an Admin or Büro approval in that organization creates the membership, in one database function. A signed-in user gets a limited number of failed join attempts per hour. | `lib/org/join-request-actions.ts`, migrations `20261001104036_limit_organization_join_attempts.sql` and `20261002140000_create_organization_join_requests.sql`, `lib/org/join-limit.test.ts`, `lib/org/join-request-actions.test.ts`, `sql:join-requests`. |
| Database | RLS restricts every client read and write. No table and no `SECURITY DEFINER` function is granted to `anon`. A definer function in `public` is executable by `service_role` only, and `authenticated` executes only the RLS helpers that its policies need. Ledger tables refuse direct UPDATE and DELETE, also for privileged roles. Every table grant is explicit. | `sql:security` runs the role, grant, ledger and Realtime assertions in `supabase/tests/security_boundaries.sql`. Its inventories of anonymous grants and of definer functions that `authenticated` executes carry a reason per entry. `canary:security` checks the live DEV grants. |
| Service-role queries | The admin client bypasses RLS. A query on a table with an `organization_id` column filters by the organization or carries a reviewed `tenant-scope` reason. | `lib/conventions/tenant-scope.test.ts`. It treats a client it cannot prove to be the caller's RLS client as privileged, and fails on an annotation that excuses no query. |
| Closed time periods | A closed period freezes the recorded time of its month for every writer, including service-role code. Close refuses with `period_open_sessions` while a session that began before the period end is still open. | Database triggers raise SQLSTATE `WFP01`. `isPeriodClosedError` in `lib/time-tracking/closed-periods.ts` maps it to `period_closed`. `sql:closed-period-writes` runs `supabase/tests/closed_period_writes.sql`. |
| Abuse limits | Invite mail, invite redemption, email-change codes and the simulated payment pass a limit per subject. A limiter that cannot decide refuses the operation. A subject reaches the database only as a keyed hash. | `lib/security/rate-limit.ts`, `lib/security/rate-limit.test.ts`, `sql:rate-limits`. |
| Logs | Server code logs a failure as a fixed label plus its name, code and status, never the error's message or details. | `logError` in `lib/logging.ts`. The `no-restricted-properties` rule in `eslint.config.mjs` rejects `console` in `lib/`, `app/api`, `app/auth` and `proxy.ts`. |
| Cross-organization writes | A write that names another record (a job, a person, an entry) checks that the record belongs to the caller's organization and, where it applies, to the same person. | The owning action plus a boundary test that drives the real action with a foreign id, for example `lib/testing/fixtures/join-request-boundaries.ts`. |
| Realtime | One channel per organization. RLS governs INSERT and UPDATE delivery, so a person who waits for a join request joins that organization's channel and receives only their own request. Raw DELETE and TRUNCATE publication is off. Database triggers write minimal deletion notices that only current members receive. Consumers treat an event as a signal and read again through an authorized reader. | `bun run realtime:check`, the Realtime assertions in `sql:security`, and `canary:security` for foreign and removed receivers. [Realtime and caching](realtime-and-caching.md) owns the transport. |
| Files | Bytes live in private buckets. Server code authorizes the target, builds the storage key and signs a short-lived URL. Finalization checks size and existence again. Every storage key starts with the owning organization id. Every operation of the storage adapter takes that id and refuses a key outside it, a traversal segment and an empty segment. Types other than images and PDF download as attachments. The storage adapter and the admin client never reach the browser. | `assertOrganizationStorageKey` in `lib/storage/r2.ts` with `lib/storage/r2.test.ts`, `lib/documents/upload-targets.test.ts`, `lib/security/storage-import-boundary.test.ts`. [Document storage and access](document-storage-and-access.md) owns the access classes. |
| Email change | One service-only RPC serializes every challenge transition per account. Send windows per mailbox survive a reset of the wizard. A completion claim permits one Auth update. Client roles cannot read either state table. | `supabase/tests/email_change_boundaries.sql`, `lib/security/account-boundaries.test.ts`. |
| Mail | The edge functions accept only the project's secret keys and escape every interpolated value. The email-change code is stored as a keyed hash over user id and code. Missing configuration and provider failure return a failure. Logs hold fixed error codes and status numbers, never recipients, codes, invitation links or provider bodies. | `supabase/functions/_shared/`, `lib/settings/otp-hash.ts`, `lib/security/mail-handlers.test.ts`. |
| Browser | Responses carry the hardening headers and the enforced Content-Security-Policy from `buildSecurityHeaders` in `next.config.ts`. Only the production deployment sends HSTS. The script policy allows the app's own origin and inline scripts. Violations go to `POST /api/csp-report`, which is unauthenticated by design, stores nothing and logs a redacted summary. An `eval` report, or one that names another origin, is a finding. | `lib/security/headers.test.ts` calls the real builder. `lib/security/csp-report.test.ts` pins the directives. |
| Dependencies | A dependency or gate change, and every release plan, runs the advisory check. An unknown finding, a changed applicability input and an expired exception fail. A network failure leaves the check unverified. | `bun run security:dependencies` (`static:dependencies`). Reviewed exceptions live in `lib/security/dependency-exceptions.json`. |

## Checklist

The tag names the mechanism that fails on a violation. A `[judgment]` item here is a hard rule that review enforces, not a default. Only the two Tier 3 defaults of virtue 3 in `AGENTS.md` admit a recorded divergence.

- Every export of a `'use server'` module establishes the caller's identity on the server, never from an argument. A helper that needs the admin client or a trusted user id lives in a `server-only` module. [test `lib/security/server-action-authorization.test.ts`]
- Every parameter of an exported Server Action is parsed by a schema or a named validator before its first use. [test `lib/conventions/server-action-input.test.ts`]
- The server parses the input before its first use, and establishes identity, organization, role, lifecycle and object permission before any protected operation. A boundary test drives the real action with a foreign id. [judgment]
- A service-role query on a table with an `organization_id` filters by the organization or carries a reviewed `tenant-scope` reason. [test `lib/conventions/tenant-scope.test.ts`]
- A route handler has a reviewed entry that names its authorization, and it never returns a raw database message. [test `lib/security/route-inventory.test.ts`]
- A handler that sets cookies or redeems a capability from a request body calls `verifySameOriginJsonRequest`. [test `lib/security/same-origin.test.ts`, test `lib/security/redeem-invite-http.test.ts`]
- A new authenticated route area is routed by `proxy.ts`. [test `lib/security/proxy-prefixes.test.ts`]
- An identity check that cannot complete is a failure, never a signed-out caller and never access. `getAuthenticatedUser` returns null only for a missing session and the rejection codes in `lib/auth/identity-errors.ts`, and throws a sanitized `AuthUnavailableError` otherwise. A page shows it through `app/(app)/error.tsx` or `app/error.tsx`, a GET handler answers with a private 500, and the proxy lets the request through. [test `lib/security/proxy-session.test.ts`, test `lib/data/background-read-http.test.ts`]
- The migration that creates a table enables RLS, adds the policies its client access needs, revokes everything from `public`, `anon`, `authenticated` and `service_role`, and grants exactly the needed operations to exactly the needed roles. The migration role has its default grants revoked, so a new table has no Data API access unless its migration grants it. Grant to `authenticated` only where a policy exists, and to `anon` never without the owner's approval. Grant sequence privileges when an intended insert needs them: the service role bypasses RLS, not SQL privileges. [group `sql:security`]
- A public `SECURITY DEFINER` function revokes execution from `PUBLIC`, `anon` and `authenticated` and grants it to `service_role`. An RLS helper that client roles must execute lives in `app_private`, is granted to `authenticated` only, and joins the definer-execution inventory in `supabase/tests/security_boundaries.sql` with the policy that needs it. [group `sql:security`]
- A new table that feeds the period calculation gets the closed-period trigger. [group `sql:closed-period-writes`]
- A new ledger table refuses direct rewriting, also by privileged roles, with a real denial and a permitted-cleanup assertion. Cascade or reference-nulling follows the domain's retention rule. [group `sql:security`]
- A service-only list or search function revokes browser execution, and its server caller resolves organization and role before it uses the admin client. [group `sql:list-pagination`, group `sql:planning-options`]
- A schema change follows [the migration rule](environments.md#the-migration-rule). [script `migrations:check`, script `types:check`]
- Every storage key starts with the owning organization id and goes through the storage adapter. [code `lib/storage/r2.ts`, test `lib/storage/r2.test.ts`]
- The storage adapter and the admin client never reach a browser bundle, and file bytes never pass through a Server Action. [test `lib/security/storage-import-boundary.test.ts`, judgment]
- A redirect destination from a query string goes through `resolveSafeReturnPath`. [test `lib/auth/return-path.test.ts`]
- The active-organization cookie counts only for a current member. [test `lib/org/active-cookie.test.ts`, test `lib/data/membership-freshness.test.ts`]
- A GET handler that shares identity reads follows [read-request authorization reuse](#read-request-authorization-reuse). [test `lib/data/read-request-cache.test.ts`]
- A provider failure returns a stable error code. Logs hold reviewed classifications and status numbers, never recipients, codes, links or provider bodies. [test `lib/security/mail-handlers.test.ts`, judgment]
- Server code logs a failure through `logError`, never through `console`. [lint `no-restricted-properties`, code `lib/logging.ts`]
- A reader cached across requests throws `CachedReadError` on a failed read, so the cache never keeps a failure. [code `lib/data/cached-read-failure.ts`, test `lib/data/cached-read-failures.test.ts`]
- A new operation that sends mail, redeems a capability or activates billing registers a limit in `lib/security/rate-limit.ts`. [test `lib/security/rate-limit.test.ts`, group `sql:rate-limits`]
- Account and email-change transitions stay atomic and server-only. [test `lib/security/account-boundaries.test.ts`]
- Responses keep the hardening headers and the enforced Content-Security-Policy. [test `lib/security/headers.test.ts`, test `lib/security/csp-report.test.ts`]
- Product code imports Zod through `lib/zod.ts`, which turns off its `eval` probe. [code `lib/zod.ts`, test `lib/conventions/zod-entry.test.ts`]
- A dependency or gate change runs the advisory check. An exception names its exact path, reason, digest and expiry. [group `static:dependencies`, test `lib/security/dependency-audit.test.ts`]
- Live DEV grants and Realtime delivery to foreign and removed receivers pass before a release. [group `canary:security`]
- Every residual exposure the owner accepted is listed below until it closes. [judgment]

## Never

- Restrict an operation only in the UI. [judgment]
- Trust an id, an organization or a role that the client sent. [judgment]
- Export a helper from a `'use server'` module. [test `lib/security/server-action-authorization.test.ts`]
- Grant to `anon`, or leave a table without RLS or a client grant without a policy. [group `sql:security`]
- Call `signOut()` without an explicit scope. [lint `authSelectors`]
- Write the production project ref outside `scripts/`. [lint `prodRefSelectors`]
- Log personal data, codes, provider bodies or a raw error object. [lint `no-restricted-properties`, test `lib/security/mail-handlers.test.ts`, judgment]
- Cache a permission fact across requests, or an authenticated response at the CDN. [test `lib/data/membership-freshness.test.ts`, judgment]
- Add a retry or a cookie fallback that turns a failed identity check into access. [test `lib/security/proxy-session.test.ts`]
- Write to PROD outside a release the owner requested. [judgment]

## Verify your work

1. Run `bun run test:unit`. The tests under `lib/security/` and `lib/conventions/` pass.
2. For a migration, a policy or a privileged function, run `bun run test:verify --group sql:security` on the local stack, plus the SQL group that owns the touched table or function, such as `sql:closed-period-writes` or `sql:list-pagination`. Then run `bun run migrations:check` and `bun run types:check`.
3. For a dependency change, run `bun run security:dependencies`. A network failure leaves it unverified, not passed.
4. Before a release, the cloud canary runs `canary:security` against DEV (`bun run test:verify --target cloud`).
5. Record the Tier 3 answers in the slice record, or in the commit message outside a slice: which permission check guards each new operation and why it is the right one, and every residual exposure with the owner's acceptance.

## Known residual exposure

The owner accepted each item. Each stays listed until it closes.

- Injected inline scripts are not blocked. The enforced script policy allows `'unsafe-inline'`, so it stops scripts and plugins from foreign origins but not an inline script that an attacker places into a page. Closing the gap needs a nonce per request, which makes every authenticated page render per request.
- No edge rate limit covers every request. The application limits the operations that send mail, redeem a capability or activate billing, and Supabase Auth limits its own endpoints. Edge limiting is the owner's Vercel plan decision.
- The deletion transport lets current members of an organization receive the identity of a deleted row. It carries no record content.
- `simulatePayment` in `lib/subscription/actions.ts` lets any authenticated user activate their own organization's subscription. It is the beta activation path and closes with the payment slice.
- Member removal refuses a target with recorded time. `P1-33` owns complete offboarding and asset return.
- Production runs the Next.js version of the last release until the release before Wave 3 ships the patched version that `main` already pins.
- A reviewed dependency exception is open for the lint toolchain; `lib/security/dependency-exceptions.json` holds its reason and expiry.
- Two provider facts are unverified: the full CORS configuration of the R2 buckets, and the scoping of the Vercel environment variables. The runtime credentials cannot read either.

## Revocation boundaries

| Consumer | Enforcement and limit |
| --- | --- |
| Privileged server reads and actions | Verified identity plus current membership, role, object and lifecycle rules. The server loads them again on each request and render. Scheduled restrictions are evaluated at read time. |
| Direct database clients | RLS consults current membership and effective personnel access. A valid JWT alone grants no organization access. |
| Realtime | INSERT and UPDATE use the table's current RLS. Deletion notices use the protected transport. Freshness inside one organization is not evidence of tenant denial. |
| Signed file URLs already issued | A URL is a bearer capability. Revocation prevents new signing; an issued URL stays valid until it expires, and a downloaded file cannot be recalled. Do not promise immediate revocation. |
| Auth sessions | [Supabase sign-out](https://supabase.com/docs/guides/auth/signout) lets an issued access token stay valid until it expires. Suspend operational access during an incident and follow the [runbook](recovery-and-incidents.md). |

## Sensitive-data handling and owner decisions

| Data | Purpose and access | Retention responsibility |
| --- | --- | --- |
| Customer contacts, sites, work records, signatures | Organization operations. Roles and assignments restrict reads and writes. | Preserve business history and the explicit trash and version behavior. The owner sets contractual retention and deletion rules before client data is imported. Add no guessed automatic deletion period. |
| Personnel, sickness, time, payroll exports | Employment operations. Personnel access classes and explicit releases are separate from the document library. An export is a copy outside the app's access control. | The owner decides lawful purpose, recipients and retention with appropriate advice. Ending access does not authorize deleting employment or time history. |
| Mail | Invitations and code delivery. These handlers send no business documents. | The provider's mail metadata has its own lifecycle. Never log invitation links, codes or recipient addresses. |
| Logs, traces, test artifacts | Diagnosis and test evidence. Test fixtures are synthetic. `.agent-logs` is ignored by Git. | Limit access and remove secrets from exported evidence. Ignored files are neither encrypted nor purged automatically. |
| Backups and retained file versions | Recovery. Database backups hold no file bytes. | [The runbook](recovery-and-incidents.md) records backup coverage and accepted loss. Deleting a live record does not erase a retained backup. |

Provider data-processing agreements: [Supabase](https://supabase.com/legal/customer-resources/data-processing-addendum), [Vercel](https://vercel.com/legal/dpa), [Cloudflare](https://www.cloudflare.com/cloudflare-customer-dpa/), [Resend](https://resend.com/legal/dpa). Before sensitive client data is imported, the owner retains the applicable agreements, defines responsibilities and retention, and confirms the provider setup. EU locations alone do not establish GDPR compliance. Product analytics or session replay needs the owner's privacy and cost decision before it is added.

## Read-request authorization reuse

A GET handler may share the identity and membership reads of one request through `lib/data/read-request-cache.ts`. The rules:

- Each GET receives a fresh scope. No identity or membership result crosses requests. There is no cross-request permission cache.
- The wrapper rejects every method except GET. Never wrap a Server Action or a mutation in it, and never pass authorization context supplied by the caller into a `'use server'` export.
- A handler that takes an organization from the request requires it to equal the resolved active organization. The resolution accepts the cookie only when it names a current operational membership.
- The privileged profile lookup reads through the caller's own RLS on every call. Never replace it with a cached authorization.
- The scope carries the request's abort signal into its server-side reads, so an abandoned read cancels only its own work.
- Before you add a consumer, review the new read boundary and extend `lib/data/read-request-cache.test.ts`, which pins the reviewed consumers.

Membership alone authorizes no retained data of a removed employee: the clock-state reads check current membership in the action itself, and `lib/time-tracking/state-http.test.ts` drives the denied identities.

## Calendar correction input boundary

A calendar gesture submits source references, versions, original timestamps and proposed boundaries to the one correction action. The server resolves caller and subject, loads the source facts again inside the organization, rejects a stale or partial replacement, and rebuilds the activity metadata from trusted records. It accepts no accounting context from the client. The correction RPC owns source locking, responsibility, the ban on approving your own correction, target authorization and closed-period checks.

A correction commits only when the organization's time revision still equals the revision captured before validation. A raw write in between refuses the correction and leaves the original time unchanged. Correction history is read by server readers only, and the server filters entries by the effective employee before it returns them. `sql:p1-22` covers client denial, stale revisions and recipient visibility.

## Examples

- `supabase/migrations/20261001104036_limit_organization_join_attempts.sql`: a new table with RLS, no client policy, a full revoke and the one grant the code uses.
- `lib/testing/fixtures/join-request-boundaries.ts`: the pattern a new action copies. It runs the real join-request actions on `action-boundary-world.ts` and expects a refusal for a foreign organization's request and for a lower role.
- `lib/security/route-inventory.test.ts`: a reviewed inventory that fails on a new handler until someone names its authorization.
