create or replace function public.publish_work_template(
  p_organization_id uuid,
  p_template_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_version_number integer;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  select template.draft_version_id into v_version_id
  from public.work_templates template
  where template.id = p_template_id
    and template.organization_id = p_organization_id
  for update;
  if v_version_id is null then
    raise exception 'work_template_draft_not_found';
  end if;

  select version.version_number into v_version_number
  from public.work_template_versions version
  where version.id = v_version_id
    and version.template_id = p_template_id
    and version.organization_id = p_organization_id
    and version.status = 'draft'
  for update;
  if v_version_number is null then
    raise exception 'work_template_draft_not_found';
  end if;
  if not exists (
    select 1 from public.work_template_items item
    where item.version_id = v_version_id
  ) then
    raise exception 'work_template_item_required';
  end if;
  if app_private.work_template_dependency_has_cycle(v_version_id) then
    raise exception 'work_template_dependency_cycle';
  end if;
  if exists (
    select 1
    from public.work_template_material_lines material
    left join public.inventory_items item
      on item.id = material.item_id
     and item.organization_id = p_organization_id
     and item.is_active
     and item.item_type in ('material', 'consumable')
    left join public.inventory_locations location
      on location.id = material.preferred_location_id
     and location.organization_id = p_organization_id
     and location.is_active
    where material.version_id = v_version_id
      and (
        item.id is null
        or (material.preferred_location_id is not null and location.id is null)
      )
  ) then
    raise exception 'work_template_material_reference_unavailable';
  end if;
  if exists (
    select 1
    from public.work_template_capability_requirements requirement
    left join public.organization_capabilities capability
      on capability.id = requirement.capability_id
     and capability.organization_id = p_organization_id
     and capability.retired_at is null
    where requirement.version_id = v_version_id
      and capability.id is null
  ) then
    raise exception 'work_template_capability_reference_unavailable';
  end if;

  update public.work_template_versions
  set status = 'published',
      published_by = p_actor_id,
      published_at = now(),
      updated_at = now()
  where id = v_version_id;

  update public.work_templates
  set draft_version_id = null,
      current_published_version_id = v_version_id,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_template_id;

  insert into public.work_template_events (
    organization_id,
    template_id,
    template_version_id,
    event_type,
    event_payload,
    actor_id
  ) values (
    p_organization_id,
    p_template_id,
    v_version_id,
    'published',
    jsonb_build_object('versionNumber', v_version_number),
    p_actor_id
  );
  return v_version_id;
end;
$$;

revoke all on function public.publish_work_template(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_work_template(uuid, uuid, uuid)
  to service_role;
