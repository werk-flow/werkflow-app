-- The invoker wrappers have no caller: the app reads members and redeems
-- invites through the service-role RPCs get_org_members_for_user and
-- redeem_organization_invite_for_user (lib/members/queries.ts,
-- lib/jobs/actions.ts, app/auth/callback/route.ts,
-- app/api/redeem-invite/route.ts), and no function, policy or test calls them.
-- Migration 20261002130100 already revoked the app_private functions they wrap.
drop function public.get_org_members(uuid);
drop function public.redeem_organization_invite(text);
