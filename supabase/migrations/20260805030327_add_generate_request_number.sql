-- P1-02: org-scoped request number suggestion, mirroring generate_job_number.
create or replace function public.generate_request_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  current_year text := extract(year from now())::text;
  next_seq integer;
begin
  select coalesce(
    max(
      case
        when request_number ~ ('^ANF-' || current_year || '-[0-9]{3}$')
          then right(request_number, 3)::integer
        else null
      end
    ),
    0
  ) + 1
  into next_seq
  from client_requests
  where organization_id = p_org_id;

  return 'ANF-' || current_year || '-' || lpad(next_seq::text, 3, '0');
end;
$$;