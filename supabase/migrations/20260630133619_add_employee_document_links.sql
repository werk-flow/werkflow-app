alter table public.document_links
  add column if not exists employee_id uuid null;

alter table public.document_links
  drop constraint if exists document_links_employee_id_fkey;

alter table public.document_links
  add constraint document_links_employee_id_fkey
  foreign key (employee_id) references public.profiles(id) on delete cascade;

do $$
declare
  constraint_name text;
begin
  select c.conname
    into constraint_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'document_links'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%num_nonnulls(job_id, project_id, client_id)%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.document_links drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.document_links
  drop constraint if exists document_links_exactly_one_target_check;

alter table public.document_links
  add constraint document_links_exactly_one_target_check
  check (num_nonnulls(job_id, project_id, client_id, employee_id) = 1);

create index if not exists document_links_employee_id_idx
  on public.document_links (employee_id)
  where employee_id is not null;

create unique index if not exists document_links_unique_employee_idx
  on public.document_links (document_id, employee_id)
  where employee_id is not null;