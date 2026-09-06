# Security control map

Status: living — last reviewed 2026-09-06

Start here before adding a route handler, Server Action, privileged database call, storage path, or provider setting. This page names each security invariant, the mechanism that enforces it, and the check that catches a regression. It does not repeat environment facts ([environments](environments.md)), testing policy ([testing](testing.md)), or the finding log of the [2026-09 hardening pass](../plans/security-infrastructure-hardening-2026-09.md); it links to them.

## Trust boundaries

| Boundary | What establishes identity and permission | Enforced by |
| --- | --- | --- |
| Route handlers (`app/api/*`, `app/auth/*`) | Each handler authenticates with `supabase.auth.getUser()` or delegates to an action that does. `POST /auth/callback` additionally requires a same-origin JSON request before it writes session cookies. | `lib/security/route-inventory.test.ts` lists every handler with its mechanism; a new handler fails the unit group until it is reviewed there. `lib/security/same-origin.ts` owns the origin check. |
| Server Actions (`'use server'` modules) | Every exported function is a public POST endpoint. It must call `getAuthenticatedUser`, `authenticateAndAuthorize`, a `require*` helper, or a module helper that does, before reading or writing. The caller's user ID always comes from the verified session, never from an argument. | `lib/security/server-action-authorization.test.ts` walks every export; exceptions need an allowlist entry with a reason. Internal helpers that take an admin client or a caller-supplied user ID live in `server-only` modules such as `lib/members/queries.ts` and `lib/dispatch/readiness-target.ts`, never in a `'use server'` file. |
| Page routing | `proxy.ts` redirects cookie-less visitors away from every authenticated area; `app/(app)/layout.tsx` re-checks the session with `getUser()` and is the authority. | `lib/security/proxy-prefixes.test.ts` derives the required prefixes from the `app/(app)` folders. |
| Post-login redirects | Only same-origin paths may be used as return destinations; invite codes must be UUIDs before they are echoed. | `lib/auth/return-path.ts` with unit tests. |
| Organization context | The active organization cookie is a hint. `resolveActiveOrgId` accepts it only when the user is a current member; `setActiveOrgCookie` refuses non-members. | `lib/org/cookies.ts`; membership cache invalidated by tag on every role, removal, and lifecycle write. |
| Database | RLS is enabled on every public table. Older tables keep default `PUBLIC` grants, so their RLS policies are the only barrier; newer domains grant `SELECT` only and write through security-definer RPCs. No security-definer function in `public` may be executable by `anon` or `authenticated`. The P1-14 and later ledgers (work execution, time capture, personnel lifecycle) and the two inventory ledgers (`inventory_movements`, `inventory_audit_events`) are append-only through triggers that permit deletes only inside the organization cascade; the older `*_events` tables from Wave 1 rely on RLS policies alone. | `supabase/tests/security_boundaries.sql` (group `sql:security`) asserts the grant rules and the ledger denial with real restricted roles; the Supabase security adviser must report no `anon_security_definer_function_executable` items. |
| Realtime | One channel per organization with a client-side filter. Supabase applies each table's RLS to INSERT and UPDATE delivery; DELETE delivery carries only `(id, organization_id)` and is not RLS-filtered. Events are invalidation signals; every consumer re-reads through an authorized reader. | `bun run realtime:check` pins the minimal replica identity; residual recorded in [realtime-and-caching](realtime-and-caching.md). |
| Files | Bytes live in private R2 buckets. Server code authorizes the target, generates the storage path, and signs a short-lived URL; finalization re-checks size and existence. Non-image, non-PDF types download as attachments. `lib/supabase/admin.ts` is `server-only`; the R2 adapter is banned from browser-reachable roots. | `lib/documents/upload-targets.test.ts`, document groups, canary C2; `lib/security/storage-import-boundary.test.ts`. |
| Mail | Both edge functions accept only the project's secret keys and HTML-escape every interpolated value. | Function source under `supabase/functions/`; deployed per project with the CLI. |
| Browser | Responses carry `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a minimal `Permissions-Policy`; Vercel adds HSTS. A script CSP is not yet in place. | `next.config.ts`; `lib/security/headers.test.ts`. |
| Dependencies | `bun audit` on every dependency change; the framework must be on a release that covers all published advisories for its major line. | Recorded in the hardening plan; no automated gate yet. |

## Rules for new code

1. A `'use server'` file may only export functions that establish the caller identity first. Put helpers that need an admin client or a trusted user ID in a `server-only` module and import them.
2. A route handler needs a reviewed entry in `lib/security/route-inventory.test.ts` naming its authorization. Handlers that set cookies from a request body must call `verifySameOriginJsonRequest`.
3. A new RPC that runs as `SECURITY DEFINER` must revoke `PUBLIC`, `anon`, and `authenticated` execution and grant `service_role` explicitly, unless it is an RLS helper that signed-in users must be able to evaluate.
4. New ledger tables get the append-only trigger pattern from migration `20260906213000_harden_security_boundaries.sql` and a denial assertion in `supabase/tests/security_boundaries.sql`.
5. Never echo provider error messages to the client. Log them, return a stable error code.
6. Redirect destinations from query strings go through `resolveSafeReturnPath`.

## Known residual exposure

- Member removal deletes the member's time history until `P1-33` (owner decision, see the hardening plan).
- No application-level rate limiting; Supabase Auth limits cover sign-in, OTP, and mail. Edge rate limiting needs the Vercel plan decision.
- DELETE events reveal deleted row identity across organizations to a subscriber who edits the client filter.
- Wave 1 `*_events` tables (client, sickness, vacation, planning, attention) have no append-only trigger; managers with the `ALL` policy could rewrite them. The enforcement backlog carries the conversion.
- Nine transitive development packages still carry advisories at nested versions pinned by ESLint, PostCSS, and the Supabase CLI; none is reachable from a request path.

Recovery, monitoring, and incident handling live in [recovery-and-incidents](recovery-and-incidents.md).
