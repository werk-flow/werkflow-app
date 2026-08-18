ALTER FUNCTION public.update_time_entries_updated_at() SET search_path = public;
ALTER FUNCTION public.get_user_admin_or_manager_org_ids(uuid) SET search_path = public;
ALTER FUNCTION public.get_org_members(uuid) SET search_path = public;
ALTER FUNCTION public.get_invite_by_code(text) SET search_path = public;
ALTER FUNCTION public.redeem_organization_invite(text) SET search_path = public;
ALTER FUNCTION public.update_subscriptions_updated_at() SET search_path = public;