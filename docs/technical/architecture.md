# Technical architecture

The runtime shape of WerkFlow and the reasons behind it. `package.json` holds versions; the live project and `lib/supabase/database.types.ts` hold the schema.

## Runtime and stack

WerkFlow is a Next.js App Router app in TypeScript with React, Tailwind CSS v4 and shadcn-style primitives. `next.config.ts` enables Cache Components; pages render on the server and stream through Suspense. [Decision 0001](../decisions/0001-infrastructure-stack.md) owns the stack.

- Vercel hosts the app. `vercel.json` pins functions to Frankfurt, next to the Supabase EU database.
- Every server process runs in Europe/Berlin. Vercel and CI start Node in UTC and reserve `TZ`, so `instrumentation.ts` sets the zone before the first request.
- Supabase in the EU provides Postgres (the operational source of truth), Auth and Realtime. Server code enforces authorization; RLS is defense in depth.
- Cloudflare R2 with EU jurisdiction stores document bytes. Browsers move bytes through signed URLs from `lib/storage/r2.ts`, which avoids the Server Action body limit and server egress.
- Profile avatars are the exception: a public Supabase Storage bucket through `lib/profile-avatar.ts`.
- R2 alone is no compliance archive; a separate S3 bucket with Object Lock will hold retention-relevant copies. Railway hosts future long-running workers. Phase 2 AI uses provider APIs with server-side keys.

Never migrate the database, auth or hosting provider, or route file bytes through server compute, without a superseding decision record.

## Application shape

The route tree under `app/` is the authority. `app/(app)/` holds the authenticated shell. Authentication, onboarding, the subscription upgrade and the invite error live outside it.

Route handlers exist for auth callbacks and flash messages, invite redemption, CSP reports, and authorized reads that must stay out of the Server Action queue ([reads outside the queue](realtime-and-caching.md#reads-outside-the-server-action-queue)). They are not confined to `app/api/`. [Security](security.md#add-a-server-action-or-route-handler) owns a new handler.

- **Page shell.** Every authenticated page renders `PageShell`, `PageHeader` and `PageBody`. `PageBody` owns padding and the scroll region. An area with subpages renders the shell and a persistent header in its `layout.tsx`, so the header does not blink. The `werkflow-design` skill owns the UI rules.
- **Tailwind sources.** Tailwind scans an explicit boundary in `app/globals.css`, which keeps build backups and browser evidence out of class discovery. Add a source entry when a new product-code root emits classes.
- **Request edge.** `proxy.ts` replaces `middleware.ts`. It reads the cookie session without validating the JWT and redirects an unauthenticated request for a protected path to `/login`. It is a routing convenience. Authorization lives in `app/(app)/layout.tsx`, the Server Actions and RLS.

## Supabase access model

One client factory per trust boundary under `lib/supabase/`:

| File | Use |
| --- | --- |
| `client.ts` | Browser singleton under the user's JWT and RLS. Carries the Realtime connection. |
| `server.ts` | Server rendering and Server Actions. Reads request cookies with the publishable key, so RLS applies. |
| `admin.ts` | Service-role singleton that bypasses RLS. Imports `server-only`. |
| `implicit-client.ts` | Browser client with the implicit flow, for the forgot-password form only: the client that sends the recovery email decides the link's flow. |
| `transient-client.ts` | Browser client without a persisted session. The password-change card verifies the current password with it. |

- Server code that uses the admin client establishes identity and authorization first ([security](security.md#trust-boundaries)).
- Membership and role are read fresh on every request ([permission facts](realtime-and-caching.md#permission-facts)). An in-flight request is still a snapshot, so a write that needs atomic authorization reauthorizes inside its database RPC.
- Time transitions use that form: the action validates and calls a versioned RPC that reauthorizes and writes every row in one transaction. Browser clients keep SELECT-only access to the time tables.
- Supabase environment values are read only through `lib/env/public.ts` and `lib/env/server.ts`. The R2 credentials are the exception, read in `lib/storage/r2.ts`.

## Authentication and organization context

After sign-in a user enters the app, or onboarding without an organization. A cookie stores the active organization. The roles `admin`, `buero` and `employee` differ on purpose: employees get simple, focused flows; Admin and Büro get overview and control.

## Data, caching and freshness

The [conceptual data model](data-model.md) owns the domain model. Keep no column-by-column schema in docs.

The app caches a few identity-keyed reads across requests, reads everything else per request after authorization, and uses Realtime events as signals to read again. Add no client fetching or polling where server rendering, invalidation and the Realtime hooks serve. [Realtime and caching](realtime-and-caching.md) owns the rules.
