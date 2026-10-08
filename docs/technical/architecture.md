# Technical architecture

Status: living — last reviewed 2026-10-05

This document describes the runtime shape of WerkFlow and the reasons behind it. For exact schema, inspect the live Supabase project and `lib/supabase/database.types.ts`. Coding standards live in `AGENTS.md`.

## Runtime and framework

WerkFlow is a Next.js App Router application in TypeScript with React, Tailwind CSS v4 and shadcn-style UI primitives. Supabase provides auth, the database, generated types and Realtime. `package.json` is the source of truth for versions.

`next.config.ts` enables Cache Components. Pages render on the server and stream through Suspense.

## Infrastructure stack

[Decision 0001](../decisions/0001-infrastructure-stack.md) owns the accepted stack and its rationale. The target state:

- Vercel hosts the Next.js app. `vercel.json` pins functions to Frankfurt, next to the Supabase EU database.
- Supabase in the EU provides Postgres as the operational source of truth, Auth and Realtime. Server code enforces authorization. RLS is defense in depth, not the only barrier.
- Cloudflare R2 with EU jurisdiction stores document bytes. Browser uploads and downloads use signed URLs from `lib/storage/r2.ts`, which avoids the Server Action request-body limit and application-server egress. Server-generated files go to storage through `putStorageObject`. Postgres keeps file metadata.
- Profile avatars are the exception. They use a public Supabase Storage bucket through `lib/profile-avatar.ts`, and their URLs need no authentication.
- A separate S3 bucket with Object Lock in compliance mode will hold retention-relevant document copies. R2 alone is not a compliance archive.
- Railway is the home for future long-running workers. Add it when the first such workload exists.
- Phase 2 AI uses external model provider APIs with server-side keys. There are no self-hosted models and no GPU infrastructure.

Do not migrate the database, auth or hosting providers, and do not route file bytes through server compute, without a superseding decision record.

## Application shape

The route tree under `app/` is the authority for what exists. `app/(app)/` holds the authenticated product shell and its pages. Authentication, onboarding, the subscription upgrade and the invite error live outside that shell.

Route handlers exist for four reasons: auth callbacks and flash messages, invite redemption, the browser's Content Security Policy reports, and authorized reads that must stay out of the browser's Server Action queue. [Realtime and caching](realtime-and-caching.md#reads-outside-the-server-action-queue) owns the reason and the rules for those reads. Route handlers are not confined to `app/api/`. The security route inventory test checks the current handler set, and [security](security.md) owns the rules for a new handler.

### Page shell

Every authenticated page renders one column through `PageShell`, `PageHeader` and `PageBody`. `PageBody` owns padding and the scroll region. An area with subpages renders the shell and a persistent header in its `layout.tsx`, so the header does not blink while a page loads. The `werkflow-design` skill owns these rules and the rules for lists, skeletons, form controls and feedback.

Tailwind v4 scans an explicit boundary declared in `app/globals.css`, which keeps build backups and retained browser evidence out of class discovery. `lib/ui/tailwind-source.test.ts` pins that boundary. Add a source entry there when a new product-code root starts to emit Tailwind classes.

### Request-edge routing

`proxy.ts` at the repository root is the Next.js 16 replacement for `middleware.ts`. It reads the cookie session without validating the JWT and redirects an unauthenticated request for a protected path to `/login`. This is a routing convenience. Authorization lives in the `app/(app)/layout.tsx` redirect, in the Server Actions and in RLS. `lib/security/proxy-prefixes.test.ts` derives the required areas from `app/(app)` and checks that `PROTECTED_PREFIXES` covers them.

## Supabase access model

The app has one Supabase client factory per trust boundary under `lib/supabase/`:

- `client.ts` is the browser singleton. It runs under the user's JWT and RLS and carries the Realtime connection.
- `server.ts` is the client for server rendering and Server Actions. It reads the request cookies and uses the publishable key, so it is also RLS-bound.
- `admin.ts` is the service-role singleton. It bypasses RLS. The file imports `server-only`, so an import from a client component is a build error.
- `implicit-client.ts` is a browser client with the implicit flow. Only the forgot-password form uses it, because the client that sends the recovery email decides which flow the link opens.
- `transient-client.ts` is a browser client that persists no session. The password-change card uses it to verify the current password without replacing the signed-in session.

Server code that uses the admin client establishes identity and authorization first. [Security](security.md#checklist) owns those rules, including the request scope for GET handlers. Membership and role are read fresh on every request, as [permission facts](realtime-and-caching.md#permission-facts) describes. An in-flight request is still a snapshot, so a business write that needs atomic authorization reauthorizes inside its database RPC transaction.

Time transitions use that transactional form. A Server Action validates the request and calls a versioned RPC, which reauthorizes the actor and writes every row in one transaction. Browser clients keep SELECT-only access to the canonical time tables through RLS.

Supabase environment values are read only through `lib/env/public.ts` and `lib/env/server.ts`. The server file imports `server-only`. The R2 credentials are the recorded exception and are read in `lib/storage/r2.ts`.

Server-generated documents follow the storage boundary. The server uploads the bytes directly to the organization-scoped R2 path, then a guarded RPC registers the metadata and the lifecycle transition in one transaction. A failed registration deletes the object only after it proves that no committed row references it. Source bytes are referenced by identity and never copied through a Server Action.

[Environments](environments.md) owns project identities, target selection and the dev-first migration rule.

## Authentication and organization context

Users authenticate through Supabase Auth. After authentication, a user enters the app or onboarding, depending on whether the user belongs to an organization.

WerkFlow is organization-scoped. A user can belong to several organizations, and a cookie stores the active organization. Operational data is scoped by `organization_id`.

The roles are `admin`, `buero` and `employee`. Role-specific behavior is intentional. Employees get simple, focused flows. Admins and office users get overview and operational control.

## Data model

The [conceptual data model](data-model.md) owns the domain model. Do not keep a column-by-column schema in docs. When schema details matter, inspect live Supabase, then check the generated types, then update code and docs if the conceptual model changed.

## Caching, Realtime and freshness

The product principle is a fast initial load with fresh operational data. The app caches a few identity-keyed reads across requests, reads everything else per request after authorization, and uses Realtime events as signals to read again. Do not add client-side fetching or polling when server rendering, cache invalidation and the Realtime hooks support the workflow.

[Realtime and caching](realtime-and-caching.md) owns every rule in this area: which readers may be cached, tag invalidation, the transport, the client freshness contract, the latency targets and the procedure to [add Realtime data](realtime-and-caching.md#add-realtime-data).
