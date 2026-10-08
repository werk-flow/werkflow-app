-- One preference save changes one key of the caller's preference document.
--
-- organization_user_preferences.preferences is one JSON document with several
-- owners: the Aufträge column choice (auftraege.visibleColumns) and the
-- calendar preferences (calendar). Each save action read the whole document,
-- merged its own key and wrote the document back, so two saves of different
-- keys by the same user within one round trip lost the earlier one.
--
-- set_organization_user_preference merges one key into the stored document in
-- one INSERT ... ON CONFLICT DO UPDATE. The conflict branch locks the row and
-- merges into its latest committed version, so a concurrent save of another
-- key survives. The actions in lib/jobs/auftraege-column-preferences-actions.ts
-- and lib/calendar/preferences-actions.ts establish identity and the active
-- membership, validate the value, and pass the caller's own ids. The function
-- re-checks the membership under a share lock and refuses with the action's
-- failure codes: invalid_input, not_a_member.
--
-- p_path names the key: one element replaces a top-level key, two elements
-- replace one key inside a top-level object and keep its other keys.
-- supabase/tests/user_preference_writes.sql holds the rules.
create function public.set_organization_user_preference(
  p_organization_id uuid,
  p_user_id uuid,
  p_path text[],
  p_value jsonb
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_depth integer := coalesce(cardinality(p_path), 0);
begin
  if p_organization_id is null or p_user_id is null or p_value is null
    or v_depth not between 1 and 2
    or exists (select 1 from unnest(p_path) segment where segment is null or segment !~ '^[A-Za-z][A-Za-z0-9_]*$')
  then
    raise exception 'invalid_input';
  end if;

  -- A share lock holds the membership until commit: a removal waits for this
  -- call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_user_id
  for share;
  if not found then
    raise exception 'not_a_member';
  end if;

  insert into public.organization_user_preferences as stored (organization_id, user_id, preferences, updated_at)
  values (
    p_organization_id,
    p_user_id,
    case v_depth
      when 1 then jsonb_build_object(p_path[1], p_value)
      else jsonb_build_object(p_path[1], jsonb_build_object(p_path[2], p_value))
    end,
    now()
  )
  on conflict (organization_id, user_id) do update
  set preferences = case v_depth
      when 1 then stored.preferences || jsonb_build_object(p_path[1], p_value)
      else stored.preferences || jsonb_build_object(
        p_path[1],
        case when jsonb_typeof(stored.preferences -> p_path[1]) = 'object'
          then stored.preferences -> p_path[1]
          else '{}'::jsonb
        end || jsonb_build_object(p_path[2], p_value)
      )
    end,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_organization_user_preference(uuid, uuid, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.set_organization_user_preference(uuid, uuid, text[], jsonb) to service_role;
