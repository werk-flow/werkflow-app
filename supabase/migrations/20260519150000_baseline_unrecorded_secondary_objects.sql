-- Baseline repair migration (part 2).
--
-- Companion to 20251129053500_baseline_unrecorded_core_schema.sql: these
-- objects were also created outside the recorded migration history, but on
-- tables that only exist later in the history (time_entries,
-- email_change_challenges, job_instruction_items), so they are materialized
-- here, after their dependencies. Fully idempotent — a no-op where the
-- objects already exist (prod).

-- 1) Unrecorded job link on time_entries (column + FK were added outside the
-- recorded history when job-linked time tracking landed)
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'time_entries'
                   and column_name = 'job_id') then
    alter table public.time_entries
      add column job_id uuid references public.jobs(id) on delete set null;
  end if;
end $$;

-- 2) Unrecorded indexes
create index if not exists idx_time_entries_job_id
  on public.time_entries (job_id) where (job_id is not null);

create index if not exists job_instruction_items_organization_id_idx
  on public.job_instruction_items (organization_id);
create index if not exists job_instruction_items_created_by_idx
  on public.job_instruction_items (created_by);
create index if not exists job_instruction_items_last_status_changed_by_idx
  on public.job_instruction_items (last_status_changed_by);

-- 3) Unrecorded RLS policies on email_change_challenges
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'email_change_challenges' and policyname = 'email_change_challenges_select_own') then
    create policy "email_change_challenges_select_own" on public.email_change_challenges
      for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'email_change_challenges' and policyname = 'email_change_challenges_insert_own') then
    create policy "email_change_challenges_insert_own" on public.email_change_challenges
      for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'email_change_challenges' and policyname = 'email_change_challenges_update_own') then
    create policy "email_change_challenges_update_own" on public.email_change_challenges
      for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'email_change_challenges' and policyname = 'email_change_challenges_delete_own') then
    create policy "email_change_challenges_delete_own" on public.email_change_challenges
      for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- 4) Unrecorded realtime publication members
do $$
declare
  missing_table text;
begin
  foreach missing_table in array array['time_entries', 'entry_change_requests']
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = missing_table) then
      execute format('alter publication supabase_realtime add table public.%I', missing_table);
    end if;
  end loop;
end $$;
