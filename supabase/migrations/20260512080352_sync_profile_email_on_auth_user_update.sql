create or replace function app_private.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'app_private'
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function app_private.sync_profile_email_from_auth_user();

update public.profiles as p
set email = u.email,
    updated_at = now()
from auth.users as u
where u.id = p.id
  and p.email is distinct from u.email;