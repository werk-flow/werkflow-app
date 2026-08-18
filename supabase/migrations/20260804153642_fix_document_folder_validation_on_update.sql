-- Same order-dependency as validate_document_folder_org: validating the
-- (unchanged) folder link on every UPDATE fails for any document row touched
-- while its folder is soft-deleted (trash flows, restores, batch deletes).
-- Validate the folder link only on INSERT or when it actually changes; the
-- storage-path prefix check stays on every write because it is row-local.
create or replace function app_private.validate_document_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  folder_org_id uuid;
begin
  new.display_name := btrim(new.display_name);
  new.original_file_name := btrim(new.original_file_name);

  if new.folder_id is not null
    and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id) then
    select organization_id into folder_org_id
    from public.document_folders
    where id = new.folder_id
      and deleted_at is null;

    if folder_org_id is null or folder_org_id <> new.organization_id then
      raise exception 'document folder must belong to the same organization';
    end if;
  end if;

  if split_part(new.storage_path, '/', 1) <> new.organization_id::text then
    raise exception 'document storage path must start with organization id';
  end if;

  return new;
end;
$function$;