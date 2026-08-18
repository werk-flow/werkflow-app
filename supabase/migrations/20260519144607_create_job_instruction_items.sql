create table if not exists public.job_instruction_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  content text not null,
  sort_order integer not null default 0,
  is_completed boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_status_changed_by uuid null references public.profiles(id),
  last_status_changed_at timestamptz null,
  constraint job_instruction_items_content_not_blank check (btrim(content) <> '')
);

create index if not exists job_instruction_items_job_id_sort_order_idx
  on public.job_instruction_items (job_id, sort_order);

create index if not exists job_instruction_items_org_job_idx
  on public.job_instruction_items (organization_id, job_id);

alter table public.job_instruction_items enable row level security;

drop policy if exists "Users can view permitted instruction items" on public.job_instruction_items;
create policy "Users can view permitted instruction items"
  on public.job_instruction_items
  for select
  to authenticated
  using (
    organization_id in (
      select app_private.get_user_org_ids((select auth.uid() as uid))
    )
    and (
      exists (
        select 1
        from public.organization_members om
        where om.organization_id = job_instruction_items.organization_id
          and om.user_id = (select auth.uid() as uid)
          and om.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
      )
      or exists (
        select 1
        from public.job_assignments ja
        where ja.job_id = job_instruction_items.job_id
          and ja.user_id = (select auth.uid() as uid)
      )
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_instruction_items'
  ) then
    alter publication supabase_realtime add table public.job_instruction_items;
  end if;
end $$;