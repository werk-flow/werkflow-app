-- Organization invites table
create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invite_code text not null unique,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint invites_accepted_status check (
    (status = 'accepted' and accepted_at is not null)
    or (status in ('pending','expired') and accepted_at is null)
  )
);

-- Indexes for efficient lookups
create index if not exists idx_invites_org on public.organization_invites(organization_id);
create index if not exists idx_invites_email on public.organization_invites(email);

-- One pending invite per org/email (prevents duplicate pending invites)
create unique index if not exists organization_invites_unique_pending_email
on public.organization_invites(organization_id, email)
where status = 'pending';
