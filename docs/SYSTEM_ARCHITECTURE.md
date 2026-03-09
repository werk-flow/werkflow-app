# WerkFlow App - System Architecture & Implementation Guide

## Overview

WerkFlow is a Next.js 15 application with Supabase for authentication and database, using ShadCN UI components with Tailwind CSS v4. The app supports multi-organization membership with role-based access control.

---

## Database Schema

### Tables

#### `profiles`
- `id` (uuid, PK, FK to auth.users.id)
- `email` (text)
- `first_name` (text, nullable, default '')
- `last_name` (text, nullable, default '')
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

**Note**: Profiles are automatically created via a database trigger `on_auth_user_created` when a user signs up. No client-side INSERT is allowed.

#### `organizations`
- `id` (uuid, PK)
- `name` (text)
- `admin_id` (uuid, FK to profiles.id) - The owner/creator of the org
- `unique_code` (text, unique) - 6-8 char alphanumeric code for joining
- `created_at` (timestamptz)

**Note**: A trigger `add_admin_membership` automatically creates an admin membership when an organization is inserted.

#### `organization_members`
- `id` (uuid, PK)
- `user_id` (uuid, FK to profiles.id)
- `organization_id` (uuid, FK to organizations.id)
- `role` (org_role enum)
- `joined_at` (timestamptz)

**Unique constraint**: (user_id, organization_id)

#### `organization_invites`
- `id` (uuid, PK)
- `organization_id` (uuid, FK to organizations.id)
- `email` (text) - The invited user's email
- `invite_code` (text, unique) - Unique code for the invite link
- `status` (invite_status enum)
- `invited_role` (org_role enum, default 'employee') - Role assigned upon acceptance
- `created_at` (timestamptz)
- `expires_at` (timestamptz)
- `accepted_at` (timestamptz, nullable)

#### `subscriptions`
- `id` (uuid, PK)
- `user_id` (uuid, FK to profiles.id)
- `status` (text: 'active', 'inactive', 'canceled', 'trialing')
- `plan_id` (text, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

#### `clients`
- `id` (uuid, PK)
- `organization_id` (uuid, FK to organizations.id, ON DELETE CASCADE)
- `name` (text, NOT NULL)
- `client_type` (client_type enum, default 'privat')
- `email` (text, nullable)
- `phone` (text, nullable)
- `address` (text, nullable)
- `notes` (text, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

#### `projects`
- `id` (uuid, PK)
- `organization_id` (uuid, FK to organizations.id, ON DELETE CASCADE)
- `client_id` (uuid, FK to clients.id, nullable, ON DELETE SET NULL)
- `name` (text, NOT NULL)
- `description` (text, nullable)
- `project_number` (text, nullable)
- `status_override` (project_status enum, nullable) - When NULL, status is derived from child jobs
- `planned_start_date` (date, nullable)
- `planned_end_date` (date, nullable)
- `created_by` (uuid, FK to profiles.id, NOT NULL)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

#### `jobs`
- `id` (uuid, PK)
- `organization_id` (uuid, FK to organizations.id, ON DELETE CASCADE)
- `project_id` (uuid, FK to projects.id, nullable, ON DELETE SET NULL) - NULL = standalone job
- `client_id` (uuid, FK to clients.id, nullable, ON DELETE SET NULL)
- `job_number` (text, nullable) - Auto-generated as AUF-{YEAR}-{SEQ}, overridable
- `title` (text, NOT NULL)
- `description` (text, nullable)
- `status` (job_status enum, default 'nicht_bearbeitet')
- `priority` (job_priority enum, default 'mittel')
- `planned_date` (date, nullable)
- `planned_time` (time, nullable)
- `estimated_duration_minutes` (integer, nullable)
- `actual_completion_date` (date, nullable)
- `location` (text, nullable)
- `created_by` (uuid, FK to profiles.id, NOT NULL)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

#### `job_assignments`
- `id` (uuid, PK)
- `job_id` (uuid, FK to jobs.id, ON DELETE CASCADE)
- `user_id` (uuid, FK to profiles.id, ON DELETE CASCADE)
- `assigned_by` (uuid, FK to profiles.id)
- `assigned_at` (timestamptz)

**Unique constraint**: (job_id, user_id)

### Enums

#### `org_role`
Values (in hierarchy order, highest to lowest):
1. `admin` - Organization owner, full permissions
2. `manager` - Can manage members and invites (up to manager role)
3. `accountant` - Standard member
4. `secretary` - Standard member
5. `employee` - Lowest role, basic access

#### `invite_status`
- `pending` - Awaiting acceptance
- `accepted` - User joined the organization
- `expired` - Invite expired (by date)
- `cancelled` - Admin/manager revoked the invite

#### `client_type`
- `privat` - Private/individual client
- `geschaeftlich` - Corporate/business client

#### `job_status`
- `nicht_bearbeitet` - Not yet started
- `in_bearbeitung` - In progress
- `fertig` - Completed

#### `job_priority`
- `niedrig` - Low priority
- `mittel` - Medium priority
- `hoch` - High priority

#### `project_status`
- `nicht_begonnen` - Not yet started
- `in_bearbeitung` - In progress
- `abgeschlossen` - Completed

---

## Row Level Security (RLS) Policies

### Key Principles
1. **SELECT policies** allow authenticated users to read data they're authorized to see
2. **INSERT/UPDATE/DELETE** operations are handled server-side using the admin client (service role key)
3. Helper functions (`SECURITY DEFINER`) bypass RLS to prevent infinite recursion

### Helper Functions

```sql
-- Returns all org IDs a user is a member of
get_user_org_ids(p_user_id uuid) RETURNS uuid[]

-- Checks if a user is a member of a specific org
is_member_of_org(p_org_id uuid, p_user_id uuid) RETURNS boolean

-- Returns org IDs where user is admin or manager
get_user_manager_or_admin_org_ids(p_user_id uuid) RETURNS uuid[]

-- Checks if email exists in auth.users (for invite validation)
check_user_exists_by_email(p_email text) RETURNS {user_id, user_exists}

-- Gets invite details by code (bypasses RLS for unauthenticated users)
get_invite_by_code(p_invite_code text) RETURNS invite details

-- Gets all clients for an organization
get_org_clients(p_org_id uuid) RETURNS SETOF clients

-- Generates the next sequential job number for an org (AUF-{YEAR}-{SEQ})
generate_job_number(p_org_id uuid) RETURNS text
```

### RLS Summary
- **profiles**: Users can SELECT/UPDATE their own profile only
- **organizations**: Users can SELECT orgs they're members of
- **organization_members**: Users can SELECT members of orgs they belong to
- **organization_invites**: Only admins/managers can SELECT invites for their orgs
- **subscriptions**: Users can SELECT their own subscription only
- **clients**: Users can SELECT clients in orgs they belong to
- **projects**: Users can SELECT projects in orgs they belong to
- **jobs**: Users can SELECT jobs in orgs they belong to
- **job_assignments**: Users can SELECT assignments for jobs in their orgs

**Note**: Non-admin/manager filtering (e.g., employees only see their assigned jobs) is enforced at the query level in server actions, not via RLS policies.

---

## Authentication Flows

### Regular Signup (No Invite)
1. User visits `/signup`
2. Fills form (email, password, first_name, last_name)
3. Supabase creates user in `auth.users`
4. Database trigger creates profile in `profiles`
5. User redirected to `/verify` for OTP verification
6. After verification, user goes to `/onboarding/start`

### Invite-Based Signup (New User)
1. Admin sends invite → creates row in `organization_invites`
2. Email sent with link: `/signup?invite_code=XXX`
3. Signup page validates invite via `get_invite_by_code` RPC
4. If invalid/expired/cancelled → redirect to `/invite-error`
5. Email field is read-only, prefilled with invited email
6. `pending_invite_code` stored in user metadata during signup
7. After OTP verification, `/api/redeem-invite` is called
8. RPC `redeem_organization_invite` adds user to org with `invited_role`
9. User redirected to `/dashboard?joined=<orgId>`

### Invite-Based Login (Existing User)
1. Existing user clicks invite link → `/login?invite_code=XXX`
2. Login page validates invite
3. After login, invite is redeemed via `/api/redeem-invite`
4. Email validation ensures invite recipient matches logged-in user
5. If mismatch → `/invite-error?error=email_mismatch`

### Logged-In User Clicks Invite Link
1. If invite is for them → redirect to `/auth/callback?invite_code=XXX`
2. If invite is for different email → `/invite-error?error=email_mismatch`
3. Error page shows option to sign out and sign in as correct user

### Password Reset
1. User requests reset at `/forgot-password`
2. Email sent with magic link
3. Link opens `/reset-password` with token in hash
4. Session established via implicit flow
5. User sets new password
6. Redirected to `/login?message=password-reset-success`

### Unverified Email on Login
1. User tries to log in with unverified email
2. Supabase returns "Email not confirmed" error
3. App automatically resends OTP
4. User redirected to `/verify?email=XXX`

---

## Onboarding Flows

### Admin Path (Create Organization)
1. User at `/onboarding/start` clicks "Organisation erstellen"
2. Redirected to `/upgrade` (paywall)
3. Simulated payment sets subscription to 'active'
4. Redirected to `/onboarding/create-organization`
5. User enters org name, submits
6. Server action creates org + admin membership
7. Redirected to `/dashboard?created=<orgId>`

### Employee Path (Join Organization)
1. User at `/onboarding/start` clicks "Organisation beitreten"
2. Redirected to `/onboarding/join-organization`
3. User enters organization code
4. Server validates code and admin_id compatibility
5. User added as 'employee' role
6. Redirected to `/dashboard?joined=<orgId>`

### Admin ID Compatibility Rule
- Users can belong to multiple organizations
- **All organizations must share the same `admin_id`**
- If user has no memberships, they can join ANY organization
- If user has memberships, new org's `admin_id` must match existing

---

## Organization Management

### Organization Switcher
- Located in sidebar header
- Shows current org name and user's role
- Dropdown lists all user's organizations
- Switching org sets `current_org_id` cookie
- "Organisation erstellen" button (admins only)
- "Organisation beitreten" button (non-admins only)

### Organization Info Card (Dashboard)
- Shows org name, member count
- Shows unique code with copy button (admins/managers only)
- "Organisation löschen" button (admins only)

### Organization Deletion
1. Admin clicks delete → confirmation dialog
2. Must type org name to confirm
3. Server action:
   - Deletes all `organization_members` for org
   - Deletes all `organization_invites` for org
   - Deletes the organization
4. If admin has other orgs → redirect to dashboard with next org selected
5. If admin has no orgs → redirect to `/onboarding/start`
6. Success banner displayed

---

## Role Management

### Role Hierarchy
`admin` > `manager` > `accountant` > `secretary` > `employee`

### Permissions Matrix

| Action | Admin | Manager | Others |
|--------|-------|---------|--------|
| View Mitarbeiter tab | ✅ | ✅ | ❌ |
| Invite users | ✅ | ✅ | ❌ |
| Max invitable role | manager | manager | - |
| Change roles | Up to manager | Below manager | ❌ |
| Remove members | All roles | Below manager | ❌ |
| Delete organization | ✅ | ❌ | ❌ |
| Create/edit/delete jobs | ✅ | ✅ | ❌ |
| Create/edit/delete projects | ✅ | ✅ | ❌ |
| Create/edit/delete clients | ✅ | ✅ | ❌ |
| View all jobs/projects | ✅ | ✅ | ❌ |
| View assigned jobs only | - | - | ✅ |

### Role Labels (German, Gender-Inclusive)
```typescript
const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager/in',
  accountant: 'Buchhalter/in',
  secretary: 'Sekretär/in',
  employee: 'Mitarbeiter/in',
}
```

---

## Invitation System

### Sending Invites
1. Admin/manager opens invite dialog in Mitarbeiter page
2. Enters email and selects role (manager, accountant, secretary, employee)
3. Server action `sendOrgInvite`:
   - Validates email format
   - Checks if user is already a member → error
   - Creates row in `organization_invites`
   - Determines if existing user or new user
   - Sends email via Supabase Edge Function + Resend API

### Invite Email Content
- **New users**: "Konto erstellen und beitreten" button → `/signup?invite_code=XXX`
- **Existing users**: "Anmelden und beitreten" button → `/login?invite_code=XXX`

### Invite Redemption
1. RPC function `redeem_organization_invite`:
   - Validates invite exists and is pending
   - Validates invite not expired
   - Validates email matches authenticated user
   - Checks admin_id compatibility
   - Inserts membership with `invited_role`
   - Updates invite status to 'accepted'
2. Sets org cookie to new organization
3. Returns organization ID for redirect

### Invite Cancellation
- Admin/manager can cancel pending invites
- Sets status to 'cancelled'
- Cancelled invites remain in list with status badge
- Same email can be invited again after cancellation

### Invite Deletion
- Only non-pending invites can be deleted (cancelled, accepted, expired)
- Removes row from database entirely

---

## Mitarbeiter (Employees) Page

### Access Control
- Only admins and managers can access
- Others redirected to `/dashboard`

### Tabbed Interface
1. **Mitglieder** tab - Shows organization members
2. **Einladungen** tab - Shows invitations (with pending count badge)

### Members Table
- Columns: Name, Email, Role
- Ordered by role hierarchy, then alphabetically by last name
- Actions menu (3-dot) per row:
  - "Rolle ändern" → submenu with available roles
  - "Entfernen" → confirmation dialog
- Own row has disabled actions
- Managers see limited role options

### Invitations Table
- Columns: Email, Role, Status, Created, Expires, Actions
- Status badges: Ausstehend (yellow), Akzeptiert (green), Abgelaufen (gray), Storniert (red)
- Actions menu:
  - "Stornieren" (cancel) - only for pending
  - "Löschen" (delete) - only for non-pending

---

## Key Components

### OrganizationContext
```typescript
type OrgContextValue = {
  memberships: UserOrg[]
  activeOrgId: string | null
  activeOrg: UserOrg | null
  setActiveOrg: (orgId: string) => Promise<void>
  refreshMemberships: () => Promise<void>
  isLoading: boolean
  isSubscribed: boolean
}
```

### Cookie Management
- Cookie name: `current_org_id`
- Max age: 30 days
- Options: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`

---

## Server Actions Pattern

All write operations use the admin client (service role key) to bypass RLS:

```typescript
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function someAction() {
  const supabase = await createSupabaseServerClient(); // For auth check
  const admin = createSupabaseAdminClient(); // For DB writes
  
  // Verify user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'not_authenticated' };
  
  // Perform authorization checks...
  
  // Use admin client for writes
  await admin.from('table').insert({ ... });
}
```

---

## API Routes

### `/api/redeem-invite`
- POST with `{ inviteCode }`
- Calls `redeem_organization_invite` RPC
- Sets org cookie
- Returns `{ success, organizationId, alreadyMember }`

### `/api/set-org-cookie`
- POST with `{ orgId }`
- Sets the `current_org_id` cookie

### `/auth/callback`
- Handles Supabase auth callbacks
- Processes invite codes if present
- Handles email verification redirects

---

## Success Banners

All banners auto-dismiss after 3 seconds and can be manually dismissed.

| Query Param | Banner Message |
|-------------|----------------|
| `joined=<orgId>` | "Du wurdest erfolgreich zu dieser Organisation hinzugefügt." |
| `created=<orgId>` | "Organisation erstellt — Du bist jetzt Admin." |
| `already_member=<orgId>` | "Du bist bereits Mitglied dieser Organisation." |
| `org_deleted=true` | "Die Organisation wurde erfolgreich gelöscht." |
| `role_changed_member=<name>&new_role=<role>` | Role change confirmation |

---

## Error Handling

### Invite Error Page (`/invite-error`)
Query params:
- `error=invalid_invite` - Link doesn't exist
- `error=invite_expired` - Link expired
- `error=invite_cancelled` - Admin revoked invite
- `error=invite_already_used` - Already accepted
- `error=email_mismatch&email=XXX` - Wrong user clicked link
- `error=admin_mismatch` - Can't join org with different admin

---

## File Structure

```
app/
├── (app)/                    # Protected routes with sidebar
│   ├── layout.tsx            # OrganizationProvider wrapper
│   ├── dashboard/page.tsx
│   ├── mitarbeiter/page.tsx
│   ├── auftraege/             # Jobs (future: Phase 4)
│   ├── projekte/              # Projects (future: Phase 5)
│   └── kunden/                # Clients (future: Phase 3)
├── (auth)/                   # Auth pages (centered card layout)
│   ├── login/
│   ├── signup/
│   ├── verify/
│   ├── forgot-password/
│   └── reset-password/
├── api/
│   ├── redeem-invite/route.ts
│   └── set-org-cookie/route.ts
├── auth/callback/route.ts    # Supabase auth callback
├── invite-error/page.tsx
├── onboarding/
│   ├── layout.tsx            # Fullscreen centered layout
│   ├── start/page.tsx
│   ├── create-organization/
│   └── join-organization/
└── upgrade/page.tsx

components/
├── dashboard/
│   ├── org-info-card.tsx
│   ├── joined-banner.tsx
│   ├── created-org-banner.tsx
│   ├── already-member-banner.tsx
│   └── org-deleted-banner.tsx
├── mitarbeiter/
│   ├── members-table.tsx
│   ├── invitations-table.tsx
│   ├── invite-dialog.tsx
│   ├── member-actions-menu.tsx
│   ├── invite-actions-menu.tsx
│   ├── mitarbeiter-tabs.tsx
│   └── role-change-banner.tsx
├── organization/
│   ├── organization-context.tsx
│   ├── organization-switcher.tsx
│   ├── create-org-dialog.tsx
│   └── join-org-dialog.tsx
├── org/
│   └── delete-org-dialog.tsx
├── onboarding/
│   ├── delete-account-button.tsx
│   └── org-deleted-banner.tsx
└── sidebar/Sidebar.tsx

lib/
├── jobs/
│   └── types.ts              # Job, Project, Client types, converters, constants
├── auth/actions.ts           # deleteAccount
├── invites/
│   ├── actions.ts            # sendOrgInvite
│   ├── cancel-action.ts      # cancelInvite
│   └── delete-action.ts      # deleteInvite
├── members/actions.ts        # updateMemberRole, removeMember
├── org/
│   ├── actions.ts            # createOrganization, joinOrganization, setActiveOrgCookie
│   ├── delete-action.ts      # deleteOrganization
│   ├── cookies.ts            # Cookie constants
│   └── generate-code.ts      # generateUniqueOrgCode
├── subscription/
│   ├── actions.ts            # simulatePayment
│   └── helpers.ts            # isUserSubscribed
├── roles.ts                  # ROLE_LABELS, getRoleLabel
└── supabase/
    ├── admin.ts              # Service role client
    ├── client.ts             # Browser client
    ├── server.ts             # Server client
    └── database.types.ts     # Generated types
```

---

## Important Implementation Notes

1. **Always use `getUser()` not `getSession()`** for auth checks - `getSession()` only reads cookies without validation

2. **Profile creation is handled by database trigger** - Never insert profiles client-side

3. **Use admin client for all write operations** - Ensures RLS doesn't block legitimate operations

4. **Cookie options must be consistent** - Always use `httpOnly: true`, `sameSite: 'lax'`

5. **Hard navigation after cookie changes** - Use `window.location.href` not `router.push()` to ensure cookies are read correctly. This is critical for production environments (like Vercel) where cookie timing can be an issue.

6. **Middleware handles org cookie fallback** - The middleware validates the `current_org_id` cookie for app routes (`/dashboard`, `/mitarbeiter`). If the cookie is missing or invalid, it automatically sets it to the user's first organization. This ensures there's NEVER a "no org selected" state when the user has memberships. Note: Cookies can only be SET in Server Actions, Route Handlers, or Middleware - NOT in Server Components like layouts.

7. **Invite validation happens server-side** - Use `get_invite_by_code` RPC for unauthenticated validation

8. **`pending_invite_code` in user metadata** - Tracks invite-based signups for users who close the verification page

9. **Email validation in invite redemption** - RPC checks `auth.uid()`'s email matches invited email

10. **Admin ID compatibility** - Enforced in both `joinOrganization` and `redeem_organization_invite`

11. **Role ordering in queries** - Use RPC `get_org_members` which orders by role enum then last_name

---

## Edge Cases Handled

### Orphan Users
- Users with no organizations are redirected to `/onboarding/start`
- "Delete Account" button available for orphan users
- Account deletion preserves invitation history

### Unverified Email on Login
- Automatically resends OTP and redirects to `/verify`

### Invite Link Clicked by Wrong User
- Email validation prevents wrong user from joining
- Clear error message with option to sign out and sign in correctly

### User Signs Up via Invite but Closes Verification Page
- `pending_invite_code` stored in user metadata
- On next login/verification, invite is automatically redeemed

### Cancelled Invite Clicked
- Immediate redirect to error page (no signup/login prompt)

### Organization Deletion
- All members lose access
- Members with only that org become orphan users
- Admin redirected appropriately based on remaining orgs

### Role Changes
- Users cannot change their own role
- Managers cannot assign manager role (only admins can promote to manager via invite)
- Managers can only remove users below manager level

