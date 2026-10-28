# Security control map

Every rule here is hard, also where only review enforces it. Only the two Tier 3 defaults of virtue 3 in `AGENTS.md` admit a divergence.

## How to work

### Add a table

1. Copy `supabase/migrations/20261001104036_limit_organization_join_attempts.sql`: RLS enabled, a full revoke, then exactly the grants the code uses. Follow [the migration rule](environments.md#the-migration-rule).
2. Give the table `organization_id`, or add it to the global-table list in `supabase/tests/security_boundaries.sql`.
3. Start server-only: grant `service_role` only. A client read grant comes with the policy that limits it. A client write joins the reviewed inventory.
4. A table that feeds the period calculation gets the closed-period trigger. A ledger refuses UPDATE and DELETE, and `security_boundaries.sql` asserts the denial.
5. A table the UI shows live follows [add Realtime data](realtime-and-caching.md#add-realtime-data).
6. Filter every service-role query on the table by `organization_id`, or add a reviewed `tenant-scope:` comment.
7. Run `bun run test:verify --group sql:security`, `bun run migrations:check`, `bun run types:check` and `bun run test:unit lib/conventions/tenant-scope.test.ts`.

Wrong turn: a policy that checks membership but not the role. Every member then reads through the Data API what the UI shows only to managers.

### Add a Server Action or route handler

1. Put the action in its domain's `'use server'` module and export only actions. A helper that needs the admin client or a trusted user id lives in a `server-only` module. A module a Bun script imports (`lib/storage/r2.ts`) cannot import `server-only`, which throws outside Next.
2. Parse every parameter with a schema before its first use. An id goes through `uuidSchema`.
3. Establish the caller through `lib/org/action-context.ts`: `resolveActionContext` for the active organization, `resolveActionContextFor` for an organization from a parsed argument or a loaded row. Use `lib/org/self-service-context.ts` for a person's own records. Call it unconditionally and check its failure before the first admin call or write. Take user, organization and role from it.
4. Check the role. Then load the target inside the caller's organization and check object permission and lifecycle.
5. An operation that sends mail, redeems a capability or activates billing calls `consumeRateLimit` from `lib/security/rate-limit.ts` first and checks its verdict.
6. Write. Rows that change together change in one database function call ([write related rows](code-quality.md#write-related-rows)). Return `ActionResult` with a stable code. Log a failure through `logError`.
7. A route handler gets its entry in `lib/security/route-inventory.test.ts`. A handler that sets cookies or redeems a capability from a request body calls `verifySameOriginJsonRequest` first. A GET handler redeems nothing from a query string.
8. Write the boundary test: copy `lib/testing/fixtures/join-request-boundaries.ts`, which runs the real actions on `action-boundary-world.ts`. Expect a refusal for a foreign organization's id and for a lower role.
9. Run `bun run test:unit lib/security lib/conventions/server-action-input.test.ts` and the new boundary test.

Wrong turn: trusting an id because the UI offers only the caller's own records. Every export is a public POST endpoint, and anyone can send any id.

### Add a privileged function

1. Write `SECURITY DEFINER` only when one transaction must cross RLS, such as an approval that creates a membership. A function that writes related rows for a server action runs as `security invoker`.
2. A public function is executable by `service_role` only. An RLS helper that policies call goes into `app_private`, is granted to `authenticated` only, and joins the definer-execution inventory with the policy that needs it.
3. Resolve organization and role in the server caller before it calls the function. A service-only list or search function revokes browser execution.
4. Run `bun run test:verify --group sql:security` and the SQL group that owns the function.

Wrong turn: granting `authenticated` so the browser can call the function. It then runs with its owner's rights past every policy.

### Add a storage path

Start the key with the owning organization id and go through `lib/storage/r2.ts`. Authorize on the server, then sign a short-lived URL; the browser moves the bytes ([document storage](document-storage-and-access.md)). Wrong turn: bytes through a Server Action.

### Log a failure

Call `logError('<function>: <what failed>', error)` from `lib/logging.ts`; it keeps only the error's name, code and status. Keep the label free of recipients, codes, links, row values and provider bodies. Wrong turn: `console.error(error)`, because a provider message can quote row values.

## Trust boundaries

### Requests

- **Server Actions.** Every exported action has a boundary test for a foreign id or a lower role, unless it is self-scoped and takes no id.
- **Route handlers.** Each handler authenticates the caller or delegates to an action that does. No response body or redirect URL carries an error's message or details.
- **Invites.** A GET redeems an invite only right after a code exchange in the same request.
- **Reset links.** The GET stores the hash in an httpOnly cookie; a click on the reset page redeems it (`lib/auth/recovery-link.ts`).
- **Email in URLs.** No URL carries a provider message or an email address. The next step reads the address from an httpOnly cookie scoped to its page (`lib/auth/address-cookies.ts`), the invite row, or the session.
- **Page routing.** `proxy.ts` sends a visitor without a session away from every authenticated area; a new authenticated area is routed there. `app/(app)/layout.tsx` checks the session again and is the authority.
- **Identity failure.** An identity check that cannot complete is a failure, never a signed-out caller and never access: a page shows the error page, a route handler a private 500 or 503, the auth callback `/auth/unavailable`. The proxy lets the request through to the layout. `lib/auth/identity-errors.ts` classifies Auth failures for both.
- **Redirects.** A return destination from a query string goes through `resolveSafeReturnPath` and is a same-origin path. An invite code is a UUID before the app echoes it.
- **Organization cookie.** The active-organization cookie is a hint. The server accepts it only for a current member and refuses to set it for a non-member.
- **Joining.** Join codes come from the cryptographic random source. A code creates a join request, never a membership. Only an Admin or Büro approval in that organization creates the membership, in one database function. A signed-in user gets a limited number of failed join attempts per hour.
- **Cross-organization writes.** A write that names another record checks that it belongs to the caller's organization and, where it applies, to the same person.
- **Abuse limits.** Invite mail, invite redemption, email-change codes, the simulated payment and health checks pass a limit per subject. A limiter that cannot decide refuses the operation; the health check proceeds. A subject reaches the database only as a keyed hash.

### Database

- RLS restricts every client read, by role and assignment where the server readers restrict them. `supabase/tests/client_read_boundaries.sql` proves that an employee reads only their own jobs, assignments and projects, and a suspended member nothing. Extend it for a new role-limited table.
- RLS checks effective personnel access wherever a policy or its helper reads `organization_members`, `job_assignments` or `employee_records`.
- Client roles write no table directly, except a user's own name and avatar.
- Nothing is granted to `anon` without the owner's approval.
- A table's migration revokes everything from `public`, `anon`, `authenticated` and `service_role`, then grants exactly the needed operations to the needed roles. Default grants are revoked, so a new object has no Data API access until its migration grants it.
- Grant sequence privileges when an intended insert needs them. The service role bypasses RLS, not SQL privileges.
- A ledger table refuses direct UPDATE and DELETE, also for privileged roles, with a real denial and a permitted-cleanup assertion. Cascade or reference-nulling follows the domain's retention rule.
- **Service-role queries.** A query on organization data passes an organization from the resolved context, or carries a reviewed `tenant-scope` reason.
- **Closed periods.** A closed period freezes the recorded time of its month for every writer, service-role code included. Triggers raise SQLSTATE `WFP01`; `isPeriodClosedError` maps it to `period_closed`. Close refuses with `period_open_sessions` while a session that began before the period end is open.
- **Account and email change.** Account and email-change transitions stay atomic and server-only. One service-only RPC serializes every challenge transition per account. Send windows per mailbox survive a reset of the wizard. A completion claim permits one Auth update. Client roles read neither state table.
- DEV's Auth configuration matches the reviewed posture (`auth:check`), and its advisors report nothing outside the reviewed exceptions (`advisors:check`).

### Realtime

RLS governs INSERT and UPDATE delivery, so a person waiting on a join request receives only their own request. Raw DELETE and TRUNCATE publication is off; deletion notices reach only current members. An event is a signal to read again through an authorized reader. [Realtime and caching](realtime-and-caching.md#realtime-model) owns the transport.

### Files

Buckets are private. Server code authorizes the target and signs a short-lived URL for a staging key; finalization copies it to the final key and checks it. Every storage key starts with the owning organization id and goes through the storage adapter. The storage adapter and the admin client never reach a browser bundle. A Server Action never takes file bytes, and only the reviewed writers store a server-generated file.

### Mail and providers

The edge functions accept only the project's secret keys and escape every interpolated value. The email-change code is stored as a keyed hash over user id and code. Missing configuration and provider failure return a stable error code. Logs hold fixed error codes and status numbers, never recipients, codes, invitation links or provider bodies.

### Browser

Responses carry the hardening headers and the enforced Content-Security-Policy from `buildSecurityHeaders` in `next.config.ts`. The script policy allows the app's own origin and inline scripts. Violations go to `POST /api/csp-report`, which is unauthenticated by design, stores nothing and logs a redacted summary. An `eval` report, or one that names another origin, is a finding. Product code has no HTML string sink and no `eval`, and imports Zod through `lib/zod.ts`, which turns off its `eval` probe.

### Server caches

A reader cached across requests throws `CachedReadError` on a failed read, so the cache never keeps a failure. No permission fact is cached across requests, and no authenticated response is cached at the CDN.

### Supply chain

Every plan carries an advisory check under 24 hours old. An unknown finding, a changed applicability input, an expired exception and an exception that matches no current finding fail. An exception in `lib/security/dependency-exceptions.json` names its path, reason, digest and expiry. A workflow pins each outside action to a commit SHA and its release.

## Never

- Restrict an operation only in the UI.
- Trust an id, an organization or a role that the client sent.
- Export a helper from a `'use server'` module.
- Grant to `anon`, or leave a table without RLS or a client grant without a policy.
- Call `signOut()` without an explicit scope.
- Write the production project ref outside `scripts/`.
- Render a string as HTML or evaluate it as code.
- Log personal data, codes, provider bodies or a raw error object. Log through `logError`, never `console`.
- Cache a permission fact across requests, or an authenticated response at the CDN.
- Add a retry or a cookie fallback that turns a failed identity check into access.
- Write to PROD outside a release the owner requested.

## Verify your work

1. Run `bun run test:unit`.
2. For a migration, a policy or a privileged function: `bun run test:verify --group sql:security` on the local stack, plus the SQL group that owns the table or function. Then `bun run migrations:check` and `bun run types:check`.
3. For a dependency change: `bun run security:dependencies`. A network failure leaves it unverified, not passed.
4. Before a release, the cloud canary runs `canary:security` against DEV (`bun run test:verify --target cloud`). It checks the live grants and Realtime delivery to foreign and removed receivers.
5. Record which permission check guards each new operation and why it fits, and every residual exposure with the owner's acceptance, in the slice record or the commit body.

## Known residual exposure

List every residual exposure the owner accepted here until it closes.

- Injected inline scripts are not blocked. The script policy allows `'unsafe-inline'`, so it stops foreign scripts but not an injected inline one. A per-request nonce needs every page rendered per request, which `cacheComponents` rules out. The `htmlSinkSelectors` lint set keeps product code from creating an injection point.
- No edge rate limit covers every request. The app limits operations that send mail, redeem a capability or activate billing; Supabase Auth limits its own endpoints. Edge limiting is the owner's Vercel plan decision.
- The deletion transport lets current members receive the identity of a deleted row. It carries no record content.
- `simulatePayment` in `lib/subscription/actions.ts` lets a signed-in user without an organization activate a subscription for their own account, once. It is the beta activation path and closes with the payment slice.
- The code step keeps the address for up to one hour in an httpOnly cookie scoped to `/verify`.
- The `health` edge function has no rate limit. Its constant-time 64-hex token bounds it.
- Member removal refuses a target with recorded time. `P1-33` owns complete offboarding and asset return.
- Two provider facts are unverified: the R2 buckets' CORS rules (runtime tokens get `AccessDenied` on `GetBucketCors`; a check needs an R2 token with Admin Read) and the Vercel environment scopes (a check needs a token that reads the project's environment).

## Revocation boundaries

| Consumer | Enforcement and limit |
| --- | --- |
| Privileged server reads and actions | Identity, membership, role, object and lifecycle rules load again on each request and render. Scheduled restrictions apply at read time. |
| Direct database clients | RLS consults current membership and effective personnel access. A valid JWT alone grants no organization access. |
| Realtime | INSERT and UPDATE use the table's current RLS. Deletion notices use the protected transport. Freshness inside one organization is no evidence of tenant denial. |
| Signed file URLs already issued | A URL is a bearer capability. Revocation prevents new signing; an issued URL stays valid until it expires, and a downloaded file cannot be recalled. |
| Auth sessions | [Supabase sign-out](https://supabase.com/docs/guides/auth/signout) lets an issued access token stay valid until it expires. During an incident, suspend operational access and follow the [runbook](recovery-and-incidents.md). |

## Sensitive data and owner decisions

| Data | Purpose and access | Retention |
| --- | --- | --- |
| Customer contacts, sites, work records, signatures | Organization operations, restricted by role and assignment. | Keep business history and the explicit trash and version behavior. The owner sets contractual retention and deletion rules before client data is imported. Add no guessed automatic deletion period. |
| Personnel, sickness, time, payroll exports | Employment operations, through personnel access classes and releases. An export is a copy outside the app's access control. | The owner decides lawful purpose, recipients and retention. Ending access does not authorize deleting employment or time history. |
| Mail | Invitations and code delivery. No business documents. | The provider's mail metadata has its own lifecycle. |
| Logs, traces, test artifacts | Diagnosis and test evidence. Fixtures are synthetic. | Limit access and remove secrets from exported evidence. Ignored files are neither encrypted nor purged automatically. |
| Backups and retained file versions | Recovery. Database backups hold no file bytes. | [The runbook](recovery-and-incidents.md) records coverage and accepted loss. Deleting a live record does not erase a backup. |

Before sensitive client data is imported, the owner retains the providers' data-processing agreements ([Supabase](https://supabase.com/legal/customer-resources/data-processing-addendum), [Vercel](https://vercel.com/legal/dpa), [Cloudflare](https://www.cloudflare.com/cloudflare-customer-dpa/), [Resend](https://resend.com/legal/dpa)), defines responsibilities and retention, and confirms the setup. EU locations alone do not establish GDPR compliance. Product analytics or session replay needs the owner's privacy and cost decision first.

## Read-request authorization reuse

A GET handler may share the identity and membership reads of one request through `lib/data/read-request-cache.ts`.

- Each GET gets a fresh scope. No identity or membership result crosses requests.
- Never wrap a Server Action or a mutation. Never pass caller-supplied authorization context into a `'use server'` export.
- A handler that takes an organization from the request requires it to equal the resolved active organization.
- The privileged profile lookup reads through the caller's own RLS on every call.
- A new consumer extends `lib/data/read-request-cache.test.ts`. Job-access facts share one read per render or GET scope (`lib/jobs/job-access-reads.ts`) and read fresh in a Server Action.

Membership alone authorizes no retained data of a removed employee. The clock-state reads check current membership in the action itself.

## Calendar correction input boundary

A calendar gesture sends source references and proposed boundaries to the one correction action. The server loads the source facts again inside the organization, refuses a stale or partial replacement, and takes no accounting context from the client. A correction commits only while the time revision captured before validation is current. Server readers filter correction history by the effective employee.
