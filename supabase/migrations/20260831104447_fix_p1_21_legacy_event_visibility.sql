drop policy time_segment_events_select_permitted
on public.time_segment_events;

create policy time_segment_events_select_permitted
on public.time_segment_events for select to authenticated
using (
  organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  and (
    actor_id = (select auth.uid())
    or organization_id in (
      select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
    )
    or exists (
      select 1 from public.time_sessions session
      where session.id = time_segment_events.session_id
        and session.organization_id = time_segment_events.organization_id
        and session.user_id = (select auth.uid())
    )
  )
);
