# Technical Architecture

Status: living — last reviewed 2026-09-03

This document describes the current high-level architecture of WerkFlow. It intentionally avoids duplicating exact database schema details; for exact schema, inspect the live Supabase project and `lib/supabase/database.types.ts`. Coding standards, including the implementation-simplicity rules, live in `AGENTS.md` and are not repeated here.

## Product Context

WerkFlow is a German-language operations platform for SHK businesses first, with possible future expansion to adjacent trades. The app is currently a TypeScript web app and may later be paired with a React Native mobile app.

The product goal is to become the digital operations backbone for a business: jobs/projects, employees, working time, documents, inventory, and future AI-assisted automations.

## Runtime And Framework

- Next.js `16.0.10`
- React `19.2.3`
- TypeScript
- Tailwind CSS v4
- shadcn/Radix-style UI primitives
- Supabase for auth, database, generated types, and Realtime

`next.config.ts` enables Cache Components:

```ts
const nextConfig = {
  cacheComponents: true,
};
```

Use `package.json` as the source of truth for dependency versions.

## Infrastructure Stack

The accepted stack and its rationale live in [decision 0001 — infrastructure stack](../decisions/0001-infrastructure-stack.md). Summary of the target state:

- **Vercel** hosts the Next.js app. `vercel.json` pins functions to Frankfurt (`fra1`), next to the Supabase EU database.
- **Supabase (EU)** provides Postgres (operational source of truth), Auth, and Realtime. Authorization is enforced primarily in server code; RLS is defense in depth, not the sole barrier.
- **Cloudflare R2 (EU jurisdiction)** stores all document file bytes via direct signed uploads/downloads (`lib/storage/r2.ts`, implemented in slice `P1-00a`). File bytes must not pass through Vercel Functions or Server Actions: Vercel enforces a ~4.5 MB request-body limit in production, and routing bytes through app servers adds avoidable egress cost. Postgres keeps all file metadata. Profile avatars are the one file surface outside private R2: `lib/profile-avatar.ts` stores them in the public `profile-avatars` Supabase Storage bucket, and the URL it builds from the object path needs no authentication.
- **A separate S3 bucket with Object Lock (compliance mode)** will hold retention-relevant document copies (designed in slice `P1-45`); R2 alone is not a compliance archive.
- **Railway** is the designated home for future long-running workers (OCR, imports/exports, queues, connector sync). It is added when the first such workload exists, not before.
- **Phase 2 AI** uses external model provider APIs (Anthropic/OpenAI/OpenRouter) with server-side keys. No self-hosted models or GPU infrastructure.

Agents must not migrate the database, auth, or hosting providers, and must not route file bytes through server compute, without a superseding decision record.

## Application Shape

The app uses the Next.js App Router. The top-level trees under `app/` are:

- `app/(auth)/`: login, signup, verification, forgot-password, and reset-password pages.
- `app/onboarding/`: create or join an organization, plus `meine-aufgaben`, the bounded own-onboarding view a future starter sees before access activates.
- `app/(app)/`: authenticated product shell and operational pages.
- `app/api/`: route handlers for invite redemption, the active-organization cookie, member and profile lookups, and time-entry reads.
- `app/auth/`: `callback` handles the Supabase auth callback and `flash` sets the short-lived auth flash cookie. Both are route handlers, so route handlers are not confined to `app/api/`.
- `app/upgrade/` and `app/invite-error/`: standalone pages outside the product shell for the subscription upgrade and for a failed invite redemption.

Authenticated product areas are Dashboard, Aufgaben, Kalender, Zeiterfassung with Zeitkonto and Perioden, Qualifikationen, Anfragen, Aufträge and Projekte with Übergaben, Dokumente, Inventar, Service with Anlagen, Fälle and Wartung, Arbeitsvorlagen, Mitarbeiter, Kunden, and Einstellungen. The sidebar entries live in `components/sidebar/app-shell.tsx`; the route tree under `app/(app)/` is the authority for what exists. Inventory V1 is implemented; use [inventory.md](../features/inventory.md) for the current product boundary.

### Page shell and area layouts

Since 2026-09-03 every authenticated page renders one column: `PageShell` → `PageHeader` → `PageBody` from `components/shared/page-shell.tsx` and `page-header.tsx`. The app shell's `<main>` carries no padding and no scroll region; `PageBody` owns both, hides horizontal overflow, and reserves the bottom clearance for the clock button. Areas with subpages (`/service`, `/zeiterfassung`, `/einstellungen`) render the shell and a persistent header with `AreaNav` route tabs in a `layout.tsx`; their pages render content only, and their `loading.tsx` files render content-only skeletons so the header never blinks. ESLint bans the raw column class strings outside the primitive, and the `@AUDIT-LAYOUT` browser audit walks every area at 375 px. The design rules behind this live in the `werkflow-design` skill; the record of the change is [uiux-hardening-2026-09.md](../plans/uiux-hardening-2026-09.md).

Lists follow the same one-source rule for their loading state. A list component declares its column definition once, renders header cells and `SkeletonRows` (`components/ui/skeleton-table.tsx`) from it, and exports one skeleton component that its `loading.tsx` renders; hover is a property of `TableRow`/`ListRow` (`interactive`), never a class on a call site. ESLint bans the hover literal outside `components/ui`, and `lib/ui/skeleton-pairing.test.ts` rejects loading files that build rows of their own.

### Request-edge routing

`proxy.ts` at the repository root is the Next.js 16 replacement for `middleware.ts`. It calls `getSession()` for a cookie-only session check with no network call and no JWT validation, then redirects an unauthenticated request to `/login` when the path is `/` or starts with a prefix in its hardcoded `PROTECTED_PREFIXES` list. It is a routing convenience. Authorization lives in the `app/(app)/layout.tsx` redirect, in the server actions, and in RLS.

The prefix list and the `matcher` currently lag the route tree. `/anfragen`, `/aufgaben`, `/qualifikationen`, `/arbeitsvorlagen`, and `/service` are missing, so an unauthenticated request to those routes reaches the layout redirect instead of the proxy. The gap is tracked for the hardening pass.

## Supabase Access Model

The app has five Supabase client factories, one per trust boundary:

- `lib/supabase/client.ts`: the browser singleton built with `createBrowserClient` from `@supabase/ssr`. It runs under the user's JWT and RLS and carries the Realtime connection.
- `lib/supabase/server.ts`: the SSR and Server Action client. It reads the request cookies and uses the publishable key, so it is also RLS-bound.
- `lib/supabase/admin.ts`: the service-role singleton. It bypasses RLS, so the file starts with `import 'server-only'` and a client-component import is a build error, Tier 1 on the enforcement ladder of [decision 0005](../decisions/0005-enforcement-ladder.md).
- `lib/supabase/implicit-client.ts`: a browser client with `flowType: 'implicit'`. Only the forgot-password form uses it, because the client that sends the recovery email decides which flow the link opens.
- `lib/supabase/transient-client.ts`: a browser client that persists no session. The password-change card uses it to re-verify the current password without replacing the signed-in session.

Server code that uses the admin client must establish identity and authorization first. `getAuthenticatedUser()` in `lib/data/cached.ts` is the identity read: it calls `auth.getUser()`, a network round trip, never `getSession()`, and React `cache()` memoizes it per request. `authenticateAndAuthorize()` in `lib/jobs/auth.ts` is the shared authorization gate for server actions: it resolves the user, the active organization from the cookie, and the membership role, and returns a typed `AuthContext` or a typed failure. Feature modules keep their server-only entry points in `lib/<feature>/server.ts`, and those files start with `import 'server-only'` as `lib/supabase/admin.ts` does.

Supabase environment values are read only through `lib/env/public.ts` for the URL and publishable key and `lib/env/server.ts` for the secret key and site URL; the server file is itself `server-only`. The R2 credentials are the recorded exception, read directly in `lib/storage/r2.ts`.

P1-21 time transitions follow the stricter transactional form of that boundary: a narrow authenticated Server Action validates the discriminated request, then calls a versioned database RPC. The RPC reauthorizes the actor, locks the organization-member boundary, validates tenant references and writes the session, segment, append-only event and idempotency receipt in one transaction. Browser clients retain SELECT-only access through RLS; they cannot write the canonical time tables directly.

Since 2026-08-18 WerkFlow runs two Supabase projects (decision [0003](../decisions/0003-dev-prod-environment-split.md)): production `jbgaqpdjauzoocplgdsn` and the dedicated dev project `mbkkzuqjbdvzelqvuzcn`, which serves `.env.local` and the test harness. The committed migration history in `supabase/migrations/` is the schema workflow: every change is a migration file applied dev-first, prod-second, and `lib/supabase/database.types.ts` is generated from dev. Live Supabase inspection remains the source of truth for platform state; see [environments.md](environments.md).

The historical Free-Plan exception for the leaked-password advisory is resolved: since the Pro upgrade (2026-08-21), leaked-password protection (HaveIBeenPwned check) is ENABLED on both projects (2026-08-23), together with a server-side minimum password length of 8 (matching the app's own validation) and SSL enforcement on direct database connections. There is no standing advisor exception anymore — inspect and disposition every Supabase Security and Performance Advisor finding normally, on both projects. The full auth/security configuration posture lives in [environments.md](environments.md).

## Authentication And Organization Context

Users authenticate through Supabase Auth. After authentication, users are routed either into the app or into onboarding depending on whether they belong to an organization.

WerkFlow is organization-scoped. Users may belong to multiple organizations, and the active organization is stored through app-level organization context/cookies. Most operational data should be scoped by `organization_id`.

Current role labels:

- `admin`: Admin
- `buero`: Büro
- `employee`: Handwerker/in

Role-specific behavior should be intentional. Employees should have simple, focused flows. Admins, office users, and managers need efficient overview and operational control.

## Data Model Boundaries

The conceptual domain model, one section per accepted slice, lives in [data-model.md](data-model.md). This document does not repeat it.

Do not maintain a manual column-by-column schema in docs. If schema details matter:

1. Inspect live Supabase through the MCP/plugin workflow.
2. Check generated types in `lib/supabase/database.types.ts`.
3. Then update app code and docs if the conceptual model changed.

`lib/parking/` is a legacy module name. Its actions read and write `work_blockers` rows with `kind = 'parking'`, the P1-14 model that replaced the P1-12 parking tables, so the module is live code rather than leftover P1-12 code.

P1-17 follows the existing storage boundary: the server renders deterministic customer-safe HTML and uploads those bytes directly to the organization-scoped EU R2 path through the storage adapter; a guarded database RPC then atomically registers document metadata, immutable release facts and the lifecycle transition. Source document/artifact bytes are referenced by exact identity, never copied through a Server Action. A failed post-upload registration deletes the object only after proving no committed document or release references it.

## Caching And Freshness

The app has three caching layers:

- `react.cache()` deduplicates work within a request.
- `unstable_cache()` caches data across requests behind tags.
- The Next.js 16 `'use cache'` directive with `cacheTag()` caches a function's result behind the same tag names. `lib/work-templates/server.ts` is the current user.

The `CACHE_TAGS` registry in `lib/data/cached.ts` is the single list of tag names. Server Actions that mutate cached data call `updateTag()` for the affected tags. `updateTag()` is Server-Action-only; a route handler such as `app/api/redeem-invite/route.ts` calls `revalidateTag(tag, 'max')` instead.

The product principle is fast initial load with fresh operational data. Avoid adding client-side fetching or polling when existing server rendering, cache invalidation, and Realtime patterns can support the workflow.

## Realtime

Supabase Realtime is centralized through `components/realtime/realtime-provider.tsx`.

The published table list has one home: `REALTIME_TABLES` in `lib/realtime/tables.ts`. The provider generates one organization-filtered binding per entry (`bun run realtime:check` diffs the list against the database's publication and replica-identity state), debounces events centrally, and owns the focus/visibility catch-up. Immutable ledgers stay unpublished and refetch behind their root row's signal. `eslint.config.mjs` bans `onAuthStateChange` outside the provider; the recorded exception is the password-recovery form at `app/**/reset-password-form.tsx`, which must react to the `PASSWORD_RECOVERY` event.

Surfaces consume through the live-view family: `hooks/use-live-view.ts` for client refetch views (shared debounce, generation guards, keep-last-known, dialog suspension, catch-up) and `hooks/use-realtime-router-refresh.ts` for route refreshes. Pending state on server actions comes from `hooks/use-server-action.ts`. The full freshness and latency contract lives in [realtime-and-caching.md](realtime-and-caching.md).

When adding new operational data that must stay live:

- One migration (publication membership plus minimal `USING INDEX` replica identity) and one `REALTIME_TABLES` line; the provider binds and org-filters it automatically.
- Consume through the live-view family; debounce, batching, suspension, and catch-up come with the primitive, never per surface.
- Keep employee views lightweight and manager views efficient.

## UI And Language

User-facing UI copy is German. Code, identifiers, comments, commits, and developer-facing artifacts are English. See the language and coding standards in `AGENTS.md`.

The app should feel fast, modern, clear, and hard to misuse, especially for field-worker (`Handwerker/in`) workflows.

## Related Docs

- [decision 0001 — infrastructure stack](../decisions/0001-infrastructure-stack.md): why the providers above are settled and what needs a superseding record.
- [data-model.md](data-model.md): the conceptual domain model per accepted slice.
- [realtime-and-caching.md](realtime-and-caching.md): the freshness, transport, and latency contract behind the Realtime and caching sections.
