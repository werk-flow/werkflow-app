-- P1-07: shared attention pattern — pattern-level state only.
-- Attention ITEMS are derived live by the server-side resolver from the
-- owning domains (time entries, change requests, vacation requests, client
-- requests). The only stored pattern state is per-user read markers and an
-- append-only audit of pattern-level facts, both keyed by the item identity
-- (source_type + source_id) and never duplicating domain columns.

-- ============================================================
-- attention_read_states: per-user read/seen markers
-- ============================================================

create table public.attention_read_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in (
    'time_session_approval',
    'time_change_request_approval',
    'vacation_request_approval',
    'client_request_open',
    'vacation_decision'
  )),
  source_id uuid not null,
  -- Opaque version of the item state the user last saw (e.g. 'approved:<ts>').
  -- A domain state change produces a new version, making the item unread
  -- again without ever duplicating the domain fact itself.
  state_version text not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, source_type, source_id)
);

create index attention_read_states_user_id_idx
  on public.attention_read_states (user_id);

-- ============================================================
-- attention_events: append-only audit of pattern-level facts
-- ============================================================

create table public.attention_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The user whose attention state changed (also the actor in V1).
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in (
    'time_session_approval',
    'time_change_request_approval',
    'vacation_request_approval',
    'client_request_open',
    'vacation_decision'
  )),
  source_id uuid not null,
  event_type text not null check (event_type in ('marked_read')),
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index attention_events_org_created_idx
  on public.attention_events (organization_id, created_at desc);
create index attention_events_user_id_idx
  on public.attention_events (user_id);

-- ============================================================
-- Organization validation: the referenced source row must live in
-- the same organization, and the user must be a member at write time.
-- ============================================================

create or replace function app_private.validate_attention_source_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.user_id
  ) then
    raise exception 'attention state user is not a member of the organization';
  end if;

  if new.source_type in ('vacation_decision', 'vacation_request_approval') then
    if not exists (
      select 1 from public.vacation_requests vr
      where vr.id = new.source_id and vr.organization_id = new.organization_id
    ) then
      raise exception 'attention source vacation request organization mismatch';
    end if;
  elsif new.source_type = 'client_request_open' then
    if not exists (
      select 1 from public.client_requests cr
      where cr.id = new.source_id and cr.organization_id = new.organization_id
    ) then
      raise exception 'attention source client request organization mismatch';
    end if;
  elsif new.source_type = 'time_session_approval' then
    if not exists (
      select 1 from public.time_entries te
      where te.id = new.source_id and te.organization_id = new.organization_id
    ) then
      raise exception 'attention source time entry organization mismatch';
    end if;
  elsif new.source_type = 'time_change_request_approval' then
    if not exists (
      select 1 from public.entry_change_requests ecr
      where ecr.id = new.source_id and ecr.organization_id = new.organization_id
    ) then
      raise exception 'attention source change request organization mismatch';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_attention_read_state_source
  before insert or update on public.attention_read_states
  for each row execute function app_private.validate_attention_source_org();

create trigger validate_attention_event_source
  before insert on public.attention_events
  for each row execute function app_private.validate_attention_source_org();

-- ============================================================
-- RLS: read markers are strictly self-scoped; pattern events are
-- self-or-manager (mirrors vacation_request_events). All writes go
-- through service-role server actions — no write policies.
-- ============================================================

alter table public.attention_read_states enable row level security;
alter table public.attention_events enable row level security;

create policy "Users can view their own attention read states"
  on public.attention_read_states
  for select
  using (user_id = (select auth.uid()));

create policy "Managers and the user can view attention events"
  on public.attention_events
  for select
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
  );

-- ============================================================
-- Realtime: publish both tables; replica identity full so
-- org-filtered DELETE events carry the old row.
-- ============================================================

alter table public.attention_read_states replica identity full;
alter table public.attention_events replica identity full;

alter publication supabase_realtime add table public.attention_read_states;
alter publication supabase_realtime add table public.attention_events;