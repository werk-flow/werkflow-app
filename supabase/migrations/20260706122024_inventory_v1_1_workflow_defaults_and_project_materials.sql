alter table public.job_material_lines
  drop constraint if exists job_material_lines_exactly_one_target;

alter table public.job_material_lines
  add constraint job_material_lines_target_required
  check (job_id is not null or project_id is not null);

create or replace function app_private.seed_inventory_defaults(p_org_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_names text[] := array[
    'Installation / Rohre & Fittings',
    'Sanitär',
    'Heizung',
    'Klima / Lüftung',
    'Pumpen, Armaturen & Ventile',
    'Befestigung & Verbrauchsmaterial',
    'Dichtstoffe, Chemie & Pflege',
    'Werkzeuge & Maschinen',
    'Mess- & Prüfgeräte',
    'Elektro & Regelung',
    'Sicherheit & Arbeitskleidung',
    'Sonstiges'
  ];
  category_name text;
  category_index integer := 0;
begin
  foreach category_name in array category_names loop
    insert into public.inventory_categories (organization_id, name, sort_order, is_system_default)
    values (p_org_id, category_name, category_index, true)
    on conflict (organization_id, lower(name)) do nothing;
    category_index := category_index + 10;
  end loop;
end;
$$;

with empty_default_locations as (
  select l.id
  from public.inventory_locations l
  where l.name = 'Hauptlager'
    and l.description = 'Standardlager für den Start mit WerkFlow Inventar.'
    and not exists (
      select 1 from public.inventory_stock_levels s where s.location_id = l.id
    )
    and not exists (
      select 1 from public.inventory_movements m where m.location_id = l.id
    )
    and not exists (
      select 1 from public.job_material_lines j where j.preferred_location_id = l.id
    )
    and not exists (
      select 1 from public.inventory_asset_instances a where a.current_location_id = l.id
    )
)
delete from public.inventory_locations l
using empty_default_locations e
where l.id = e.id;