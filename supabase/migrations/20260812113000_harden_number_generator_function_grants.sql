revoke execute on function public.generate_personnel_number(uuid) from public, anon, authenticated;
revoke execute on function public.generate_request_number(uuid) from public, anon, authenticated;

grant execute on function public.generate_personnel_number(uuid) to service_role;
grant execute on function public.generate_request_number(uuid) to service_role;