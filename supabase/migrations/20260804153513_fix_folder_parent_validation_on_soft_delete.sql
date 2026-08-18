-- Soft-deleting a folder subtree updates parent and child rows in one
-- statement. The previous version validated the (unchanged) parent link on
-- every UPDATE against non-deleted parents only, so subtree deletion failed
-- whenever a parent row was processed before its children. Validate the
-- parent only on INSERT or when the parent link actually changes.
create or replace function app_private.validate_document_folder_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  parent_org_id uuid;
begin
  new.name := btrim(new.name);

  if tg_op = 'UPDATE' and new.parent_folder_id is not distinct from old.parent_folder_id then
    return new;
  end if;

  if new.parent_folder_id is not null then
    select organization_id into parent_org_id
    from public.document_folders
    where id = new.parent_folder_id
      and deleted_at is null;

    if parent_org_id is null or parent_org_id <> new.organization_id then
      raise exception 'document folder parent must belong to the same organization';
    end if;
  end if;

  return new;
end;
$function$;