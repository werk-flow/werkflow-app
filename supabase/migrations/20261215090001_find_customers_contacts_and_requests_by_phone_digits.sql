-- The header search finds a customer, a contact or a request by a phone number
-- typed in any spelling, and an Einsatzort or an Ansprechpartner under any
-- matching customer (werk-flow/werkflow-planning#487). Both list readers keep
-- their signatures and every other clause.

-- 1. Whether a stored phone number contains the number a search names. The
-- search counts as a phone number only when it holds nothing but digits,
-- whitespace (a pasted number may carry no-break or thin spaces) and the
-- separators + / ( ) . -, so a name or a street with a house number never
-- matches by digits. Both sides go through app_private.normalized_phone, the
-- one owner of the digits rule: everything but digits goes, +49 and 0049
-- become the trunk 0, fewer than six digits is no number.
create function app_private.phone_matches_search(p_phone text, p_search text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $$
  select case
    when coalesce(p_search, '') !~ '^[0-9\s\u00a0\u2007\u2009\u202f+/().-]+$' then false
    else coalesce(
      strpos(app_private.normalized_phone(p_phone), app_private.normalized_phone(p_search)) > 0,
      false
    )
  end;
$$;

revoke all on function app_private.phone_matches_search(text, text) from public, anon, authenticated;
grant execute on function app_private.phone_matches_search(text, text) to service_role;

-- 2. The one owner of which active Objekte and contacts a customer search
-- matches, for the customer list and the header search: an Objekt by name,
-- street, postal code, city or Objekt number; a contact by name, email, phone
-- or phone digits.
create function app_private.customer_search_sites(p_organization_id uuid, p_search text)
returns table (id uuid, client_id uuid)
language sql
stable
set search_path to ''
as $$
  select site.id, site.client_id from public.client_sites site
  where coalesce(p_search, '') <> '' and site.organization_id = p_organization_id and site.is_active
    and strpos(lower(concat_ws(' ', site.name, site.street, site.postal_code, site.city, site.source_number)), lower(p_search)) > 0;
$$;

create function app_private.customer_search_contacts(p_organization_id uuid, p_search text)
returns table (id uuid, client_id uuid)
language sql
stable
set search_path to ''
as $$
  select contact.id, contact.client_id from public.client_contacts contact
  where coalesce(p_search, '') <> '' and contact.organization_id = p_organization_id and contact.is_active
    and (
      strpos(lower(concat_ws(' ', contact.name, contact.email, contact.phone)), lower(p_search)) > 0
      or app_private.phone_matches_search(contact.phone, p_search)
    );
$$;

revoke all on function app_private.customer_search_sites(uuid, text) from public, anon, authenticated;
grant execute on function app_private.customer_search_sites(uuid, text) to service_role;
revoke all on function app_private.customer_search_contacts(uuid, text) from public, anon, authenticated;
grant execute on function app_private.customer_search_contacts(uuid, text) to service_role;

-- 3. The customer list. A customer also matches by its phone digits and by an
-- active contact's name, email, phone or phone digits.
create or replace function public.list_customer_page(
  p_organization_id uuid, p_search text, p_page integer, p_page_size integer, p_archived boolean
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matched_sites as materialized (
    select matched.id, matched.client_id from app_private.customer_search_sites(p_organization_id, p_search) matched
  ), site_parties as materialized (
    select matched.id as site_id, matched.client_id from matched_sites matched
    union
    select role.site_id, role.holder_client_id from public.client_site_roles role
    join matched_sites matched on matched.id = role.site_id
    where role.organization_id = p_organization_id
      and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date)
  ), matching as materialized (
    select c.id, c.name from public.clients c
    where c.organization_id = p_organization_id and (c.archived_at is not null) = p_archived and (
      coalesce(p_search, '') = '' or
      strpos(lower(concat_ws(' ', c.name, c.customer_number, c.source_number, c.email, c.phone, c.address)), lower(p_search)) > 0 or
      app_private.phone_matches_search(c.phone, p_search) or
      exists (select 1 from app_private.customer_search_contacts(p_organization_id, p_search) contact where contact.client_id = c.id) or
      exists (select 1 from site_parties party where party.client_id = c.id)
    )
  ), page as (
    select id, name from matching order by name collate "de-DE-x-icu", id
    limit least(greatest(p_page_size, 1), 100) offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', client.id, 'organizationId', client.organization_id,
        'name', client.name, 'clientType', client.client_type,
        'customerNumber', client.customer_number, 'sourceNumber', client.source_number,
        'email', client.email, 'phone', client.phone, 'address', client.address, 'notes', client.notes,
        'createdAt', client.created_at, 'updatedAt', client.updated_at,
        'matchedSiteTotal', (select count(*) from site_parties party where party.client_id = page.id),
        'matchedSites', coalesce((
          select jsonb_agg(shown.site order by shown.name collate "de-DE-x-icu", shown.id)
          from (
            select site.id, site.name, jsonb_build_object(
              'id', site.id, 'name', site.name, 'street', site.street,
              'postalCode', site.postal_code, 'city', site.city, 'sourceNumber', site.source_number,
              'clientId', owner.id, 'clientName', owner.name,
              'roles', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'role', role.role, 'holderClientId', holder.id, 'holderName', holder.name
                ) order by role.role)
                from public.client_site_roles role
                join public.clients holder on holder.id = role.holder_client_id and holder.organization_id = p_organization_id
                where role.organization_id = p_organization_id and role.site_id = site.id
                  and (role.starts_on is null or role.starts_on <= (now() at time zone 'Europe/Berlin')::date)
                  and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date)
              ), '[]'),
              'equipment', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', item.id, 'name', item.name, 'equipmentNumber', item.equipment_number
                ) order by item.name collate "de-DE-x-icu", item.id)
                from (
                  select equipment.id, equipment.name, equipment.equipment_number
                  from public.installed_equipment equipment
                  where equipment.organization_id = p_organization_id and equipment.site_id = site.id
                    and equipment.archived_at is null and equipment.voided_at is null
                  order by equipment.name collate "de-DE-x-icu", equipment.id
                  limit 5
                ) item
              ), '[]'),
              'equipmentTotal', (
                select count(*) from public.installed_equipment equipment
                where equipment.organization_id = p_organization_id and equipment.site_id = site.id
                  and equipment.archived_at is null and equipment.voided_at is null
              )
            ) as site
            from site_parties party
            join public.client_sites site on site.id = party.site_id and site.organization_id = p_organization_id
            join public.clients owner on owner.id = site.client_id and owner.organization_id = p_organization_id
            where party.client_id = page.id
            order by site.name collate "de-DE-x-icu", site.id
            limit 3
          ) shown
        ), '[]')
      ) order by page.name collate "de-DE-x-icu", page.id)
      from page join public.clients client on client.id = page.id
      where client.organization_id = p_organization_id
    ), '[]')
  );
$$;

-- 4. The header search's Einsatzorte and Ansprechpartner: the active Objekte
-- and contacts of active customers that the customer search matches, each
-- limited on its own, so a match under any customer is found, not only under
-- the first page of matching customers.
create function public.search_customer_sites_and_contacts(
  p_organization_id uuid, p_search text, p_limit integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with sites as materialized (
    select site.id, site.organization_id, site.name, site.street, site.postal_code, site.city,
      owner.id as client_id, owner.name as client_name
    from app_private.customer_search_sites(p_organization_id, p_search) matched
    join public.client_sites site on site.id = matched.id and site.organization_id = p_organization_id
    join public.clients owner on owner.id = site.client_id and owner.organization_id = p_organization_id
    where owner.archived_at is null
    order by site.name collate "de-DE-x-icu", site.id
    limit least(greatest(p_limit, 1), 100)
  ), contacts as materialized (
    select contact.id, contact.organization_id, contact.name, contact.email, contact.phone,
      client.id as client_id, client.name as client_name
    from app_private.customer_search_contacts(p_organization_id, p_search) matched
    join public.client_contacts contact on contact.id = matched.id and contact.organization_id = p_organization_id
    join public.clients client on client.id = contact.client_id and client.organization_id = p_organization_id
    where client.archived_at is null
    order by contact.name collate "de-DE-x-icu", contact.id
    limit least(greatest(p_limit, 1), 100)
  ) select jsonb_build_object(
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', site.id, 'organizationId', site.organization_id, 'name', site.name,
        'street', site.street, 'postalCode', site.postal_code, 'city', site.city,
        'clientId', site.client_id, 'clientName', site.client_name
      ) order by site.name collate "de-DE-x-icu", site.id)
      from sites site
    ), '[]'),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', contact.id, 'organizationId', contact.organization_id, 'name', contact.name,
        'email', contact.email, 'phone', contact.phone,
        'clientId', contact.client_id, 'clientName', contact.client_name
      ) order by contact.name collate "de-DE-x-icu", contact.id)
      from contacts contact
    ), '[]')
  );
$$;

revoke all on function public.search_customer_sites_and_contacts(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_customer_sites_and_contacts(uuid, text, integer) to service_role;

-- 5. The request list. A request also matches by the digits of the caller's phone.
create or replace function public.list_request_page(
  p_organization_id uuid,
  p_status text default 'aktiv',
  p_search text default '',
  p_categories text[] default '{}',
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select r.id, r.received_at, r.client_id, r.assigned_to, r.converted_job_id, r.converted_project_id
    from public.client_requests r
    where r.organization_id = p_organization_id
      and case coalesce(p_status, 'aktiv')
        when 'alle' then true
        when 'aktiv' then r.status::text in ('offen', 'in_klaerung')
        else r.status::text = p_status
      end
      and (
        coalesce(p_search, '') = ''
        or r.category::text = any(coalesce(p_categories, '{}'))
        or strpos(lower(concat_ws(' ', r.summary, r.details, r.request_number, r.caller_name, r.caller_phone, r.caller_email)), lower(p_search)) > 0
        or app_private.phone_matches_search(r.caller_phone, p_search)
        or exists (
          select 1 from public.clients client
          where client.organization_id = p_organization_id and client.id = r.client_id
            and strpos(lower(client.name), lower(p_search)) > 0
        )
        or exists (
          select 1 from public.profiles assignee
          where assignee.id = r.assigned_to
            and strpos(lower(concat_ws(' ', assignee.first_name, assignee.last_name, assignee.email)), lower(p_search)) > 0
        )
      )
  ), page as (
    select * from matching order by received_at desc, id
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (select 1 from public.client_requests r where r.organization_id = p_organization_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'clientName', client.name,
        'assigneeFirstName', assignee.first_name,
        'assigneeLastName', assignee.last_name,
        'assigneeEmail', assignee.email,
        'hasAssignee', assignee.id is not null,
        'jobNumber', job.job_number,
        'jobTitle', job.title,
        'projectNumber', project.project_number,
        'projectName', project.name
      ) order by page.received_at desc, page.id)
      from page
      left join public.clients client
        on client.id = page.client_id and client.organization_id = p_organization_id
      left join public.profiles assignee on assignee.id = page.assigned_to
      left join public.jobs job
        on job.id = page.converted_job_id and job.organization_id = p_organization_id
      left join public.projects project
        on project.id = page.converted_project_id and project.organization_id = p_organization_id
    ), '[]')
  );
$$;
