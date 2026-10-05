-- Failed attempts to join an organization by its code, per signed-in user.
-- joinOrganization (lib/org/actions.ts) refuses further guesses after ten
-- failures within one hour. Rate-limit state only: no client role reads or
-- writes it, and rows leave with the user or when their window has passed.
create table public.organization_join_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index organization_join_attempts_user_attempted_at_idx
  on public.organization_join_attempts (user_id, attempted_at);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.organization_join_attempts enable row level security;

-- Valid under revoked default privileges (migration 20260928095752) and under
-- the old automatic grants alike: remove everything, then grant what is used.
revoke all on table public.organization_join_attempts from public, anon, authenticated, service_role;
grant select, insert, delete on table public.organization_join_attempts to service_role;
