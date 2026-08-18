-- Baseline repair migration.
--
-- Prod's supabase_migrations history is missing the objects below: they were
-- created directly (dashboard/manual) before migration tracking became
-- consistent. This file materializes them just before the first recorded
-- migration that DDL-touches them (20251129053550), so the recorded history
-- replays cleanly on a fresh database.
--
-- Definitions are the HISTORICAL shapes: columns, enum values, indexes, and
-- policies added by later recorded migrations (clients.customer_number,
-- jobs/projects site_id + contact_id, organization_settings holiday fields,
-- enum values 'gewerblich' and 'geparkt', idx_*_created_by, timeline indexes)
-- are intentionally absent here — those later migrations still apply on top.
--
-- Every statement is guarded, so this file is a no-op on a database where the
-- objects already exist (prod). Never edit history semantics here; see
-- docs/decisions/0003 for the environment-split and migration rules.

-- 1) Enum types (historical value sets)
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'client_type') then
    create type public.client_type as enum ('privat', 'geschaeftlich');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'job_status') then
    create type public.job_status as enum ('nicht_bearbeitet', 'in_bearbeitung', 'fertig');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'project_status') then
    create type public.project_status as enum ('nicht_begonnen', 'in_bearbeitung', 'abgeschlossen');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'job_priority') then
    create type public.job_priority as enum ('niedrig', 'mittel', 'hoch');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'time_tracking_break_mode') then
    create type public.time_tracking_break_mode as enum ('manual', 'automatic');
  end if;
end $$;

-- 2) Shared updated_at trigger function
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 3) profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text default '',
  last_name text default '',
  created_at timestamp with time zone not null default now(),
  email text,
  updated_at timestamp with time zone default now(),
  avatar_path text
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'profiles' and policyname = 'Users can view own profile') then
    create policy "Users can view own profile" on public.profiles
      for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'profiles' and policyname = 'Users can update own profile') then
    create policy "Users can update own profile" on public.profiles
      for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'profiles' and policyname = 'Org members can view co-member profiles') then
    create policy "Org members can view co-member profiles" on public.profiles
      for select to authenticated
      using (
        id = (select auth.uid())
        or exists (
          select 1
          from public.organization_members viewer
          join public.organization_members subject
            on subject.organization_id = viewer.organization_id
          where viewer.user_id = (select auth.uid())
            and subject.user_id = profiles.id
        )
      );
  end if;
end $$;

-- 4) clients
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_type public.client_type not null default 'privat',
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_clients_organization_id on public.clients (organization_id);

alter table public.clients enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'clients_updated_at'
                 and tgrelid = 'public.clients'::regclass) then
    create trigger clients_updated_at
      before update on public.clients
      for each row execute function public.update_updated_at_column();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'clients' and policyname = 'Users can view clients in their orgs') then
    create policy "Users can view clients in their orgs" on public.clients
      for select to authenticated
      using (organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid()
      ));
  end if;
end $$;

-- 5) projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null,
  description text,
  project_number text,
  status_override public.project_status,
  planned_start_date date,
  planned_end_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_projects_organization_id on public.projects (organization_id);
create index if not exists idx_projects_client_id on public.projects (client_id);

alter table public.projects enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_updated_at'
                 and tgrelid = 'public.projects'::regclass) then
    create trigger projects_updated_at
      before update on public.projects
      for each row execute function public.update_updated_at_column();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'projects' and policyname = 'Users can view projects in their orgs') then
    create policy "Users can view projects in their orgs" on public.projects
      for select to authenticated
      using (organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid()
      ));
  end if;
end $$;

-- 6) jobs
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  job_number text,
  title text not null,
  description text,
  status public.job_status not null default 'nicht_bearbeitet',
  priority public.job_priority not null default 'mittel',
  planned_date date,
  planned_time time without time zone,
  estimated_duration_minutes integer,
  actual_completion_date date,
  location text,
  created_by uuid not null references public.profiles(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  planned_working_minutes integer
);

create index if not exists idx_jobs_project_id on public.jobs (project_id);
create index if not exists idx_jobs_client_id on public.jobs (client_id);
create index if not exists idx_jobs_status on public.jobs (organization_id, status);
create index if not exists idx_jobs_planned_date on public.jobs (organization_id, planned_date);

alter table public.jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'jobs_updated_at'
                 and tgrelid = 'public.jobs'::regclass) then
    create trigger jobs_updated_at
      before update on public.jobs
      for each row execute function public.update_updated_at_column();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'jobs' and policyname = 'Users can view jobs in their orgs') then
    create policy "Users can view jobs in their orgs" on public.jobs
      for select to authenticated
      using (organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid()
      ));
  end if;
end $$;

-- 7) job_assignments
create table if not exists public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamp with time zone not null default now(),
  unique (job_id, user_id)
);

create index if not exists idx_job_assignments_job_id on public.job_assignments (job_id);
create index if not exists idx_job_assignments_user_id on public.job_assignments (user_id);

alter table public.job_assignments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'job_assignments' and policyname = 'Users can view job assignments in their orgs') then
    create policy "Users can view job assignments in their orgs" on public.job_assignments
      for select to authenticated
      using (job_id in (
        select id from public.jobs
        where organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
        )
      ));
  end if;
end $$;

-- 8) organization_settings (historical shape: no holiday fields yet)
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  break_mode public.time_tracking_break_mode not null default 'manual',
  auto_break_threshold_minutes integer not null default 360,
  auto_break_duration_minutes integer not null default 30,
  break_policy_history jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint organization_settings_threshold_check
    check (auto_break_threshold_minutes >= 1 and auto_break_threshold_minutes <= 1440),
  constraint organization_settings_duration_check
    check (auto_break_duration_minutes >= 0 and auto_break_duration_minutes <= 1440),
  constraint organization_settings_history_is_array_check
    check (jsonb_typeof(break_policy_history) = 'array')
);

alter table public.organization_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'organization_settings' and policyname = 'organization_settings_select_for_members') then
    create policy "organization_settings_select_for_members" on public.organization_settings
      for select to authenticated
      using (exists (
        select 1 from public.organization_members
        where organization_members.organization_id = organization_settings.organization_id
          and organization_members.user_id = (select auth.uid())
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'organization_settings' and policyname = 'organization_settings_update_for_admins') then
    create policy "organization_settings_update_for_admins" on public.organization_settings
      for update to authenticated
      using (exists (
        select 1 from public.organization_members
        where organization_members.organization_id = organization_settings.organization_id
          and organization_members.user_id = (select auth.uid())
          and organization_members.role = 'admin'::org_role
      ))
      with check (exists (
        select 1 from public.organization_members
        where organization_members.organization_id = organization_settings.organization_id
          and organization_members.user_id = (select auth.uid())
          and organization_members.role = 'admin'::org_role
      ));
  end if;
end $$;

-- 9) organization_user_preferences
create table if not exists public.organization_user_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (organization_id, user_id),
  constraint organization_user_preferences_object_check
    check (jsonb_typeof(preferences) = 'object')
);

create index if not exists organization_user_preferences_user_id_idx
  on public.organization_user_preferences (user_id);

alter table public.organization_user_preferences enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'organization_user_preferences' and policyname = 'organization_user_preferences_select_own') then
    create policy "organization_user_preferences_select_own" on public.organization_user_preferences
      for select to authenticated
      using (
        user_id = (select auth.uid())
        and exists (
          select 1 from public.organization_members
          where organization_members.organization_id = organization_user_preferences.organization_id
            and organization_members.user_id = (select auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'organization_user_preferences' and policyname = 'organization_user_preferences_insert_own') then
    create policy "organization_user_preferences_insert_own" on public.organization_user_preferences
      for insert to authenticated
      with check (
        user_id = (select auth.uid())
        and exists (
          select 1 from public.organization_members
          where organization_members.organization_id = organization_user_preferences.organization_id
            and organization_members.user_id = (select auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'organization_user_preferences' and policyname = 'organization_user_preferences_update_own') then
    create policy "organization_user_preferences_update_own" on public.organization_user_preferences
      for update to authenticated
      using (
        user_id = (select auth.uid())
        and exists (
          select 1 from public.organization_members
          where organization_members.organization_id = organization_user_preferences.organization_id
            and organization_members.user_id = (select auth.uid())
        )
      )
      with check (
        user_id = (select auth.uid())
        and exists (
          select 1 from public.organization_members
          where organization_members.organization_id = organization_user_preferences.organization_id
            and organization_members.user_id = (select auth.uid())
        )
      );
  end if;
end $$;

-- 10) Unrecorded helper functions (current prod definitions; later recorded
-- migrations only adjust grants/search_path on these)
create or replace function public.get_org_clients(p_org_id uuid)
returns setof clients
language sql
stable security definer
set search_path to 'public'
as $function$
  SELECT * FROM clients
  WHERE organization_id = p_org_id
  ORDER BY name ASC;
$function$;

create or replace function public.generate_job_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_year text := extract(year from now())::text;
  next_seq integer;
begin
  select coalesce(
    max(
      case
        when job_number ~ ('^AUF-' || current_year || '-[0-9]{3}$')
          then right(job_number, 3)::integer
        else null
      end
    ),
    0
  ) + 1
  into next_seq
  from jobs
  where organization_id = p_org_id;

  return 'AUF-' || current_year || '-' || lpad(next_seq::text, 3, '0');
end;
$function$;

create or replace function public.generate_project_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  current_year text;
  next_seq integer;
  result text;
BEGIN
  current_year := to_char(now(), 'YYYY');

  SELECT COALESCE(MAX(
    CASE
      WHEN project_number ~ ('^PRJ-' || current_year || '-[0-9]+$')
      THEN CAST(substring(project_number from '[0-9]+$') AS integer)
      ELSE 0
    END
  ), 0) + 1
  INTO next_seq
  FROM projects
  WHERE organization_id = p_org_id;

  result := 'PRJ-' || current_year || '-' || lpad(next_seq::text, 3, '0');
  RETURN result;
END;
$function$;

-- 11) Unrecorded unique index on organizations
create unique index if not exists organizations_admin_id_normalized_name_key
  on public.organizations (admin_id, lower(btrim(name)));

-- 12) Unrecorded realtime publication members
do $$
declare
  missing_table text;
begin
  foreach missing_table in array array[
    'profiles', 'clients', 'projects', 'organization_settings', 'organization_members'
  ]
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = missing_table) then
      execute format('alter publication supabase_realtime add table public.%I', missing_table);
    end if;
  end loop;
end $$;
