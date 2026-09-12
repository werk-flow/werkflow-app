-- Return the bounded page in one snapshot and network request.
-- Existing ids/total consumers remain compatible; browser roles stay denied.
create or replace function public.list_customer_page(
  p_organization_id uuid, p_search text default '', p_page integer default 1, p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select c.id, c.name from public.clients c
    where c.organization_id = p_organization_id and (
      coalesce(p_search, '') = '' or
      strpos(lower(concat_ws(' ', c.name, c.customer_number, c.email, c.phone, c.address)), lower(p_search)) > 0 or
      exists (select 1 from public.client_contacts contact where contact.organization_id = p_organization_id and contact.client_id = c.id and contact.is_active and strpos(lower(contact.name), lower(p_search)) > 0) or
      exists (select 1 from public.client_sites site where site.organization_id = p_organization_id and site.client_id = c.id and site.is_active and strpos(lower(concat_ws(' ', site.name, site.street, site.postal_code, site.city)), lower(p_search)) > 0)
    )
  ), page as (
    select id, name from matching order by name collate "de-DE-x-icu", id
    limit least(greatest(p_page_size, 1), 100) offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(id order by name collate "de-DE-x-icu", id) from page), '[]'),
    'total', (select count(*) from matching),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', client.id, 'organizationId', client.organization_id,
        'name', client.name, 'clientType', client.client_type,
        'customerNumber', client.customer_number, 'email', client.email,
        'phone', client.phone, 'address', client.address, 'notes', client.notes,
        'createdAt', client.created_at, 'updatedAt', client.updated_at
      ) order by page.name collate "de-DE-x-icu", page.id)
      from page join public.clients client on client.id = page.id
      where client.organization_id = p_organization_id
    ), '[]')
  );
$$;
revoke all on function public.list_customer_page(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.list_customer_page(uuid,text,integer,integer) to service_role;

