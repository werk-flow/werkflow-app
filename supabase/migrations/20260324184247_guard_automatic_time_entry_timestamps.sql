begin;

create or replace function public.guard_automatic_time_entry_timestamps()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.is_manual, false) = false
     and new.timestamp not between now() - interval '5 minutes' and now() + interval '5 minutes' then
    raise exception using
      errcode = '22007',
      message = 'Automatic time entries must be created close to the current time.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_automatic_time_entry_timestamps_insert on public.time_entries;
create trigger guard_automatic_time_entry_timestamps_insert
before insert on public.time_entries
for each row
execute function public.guard_automatic_time_entry_timestamps();

commit;