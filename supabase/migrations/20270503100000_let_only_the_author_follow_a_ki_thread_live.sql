-- WerkFlow KI: a thread's live channel (werk-flow/werkflow-planning#532).
--
-- The server sends a running answer to the author's other tabs and devices
-- over a private Realtime Broadcast channel per thread, `ki-thread:<thread id>`,
-- through Realtime's REST API with the service key. Realtime asks this policy
-- before a client joins a private channel: only the thread's author, while
-- their membership has effective access, may receive it. No policy allows an
-- insert, so no client sends on the channel; no admin follows another person's
-- thread. Every other private topic stays closed, as before.
--
-- The thread read runs under the joining user's own row-level security on
-- `ai_threads` (author only, effective access), and the policy repeats both
-- conditions, so it holds on its own.

create policy ai_thread_live_select_author on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.ai_threads thread
      -- Any other topic names no thread, so it opens nothing; the guard keeps the cast from failing.
      where thread.id = (
          case
            when (select realtime.topic()) ~ '^ki-thread:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then substr((select realtime.topic()), 11)::uuid
          end
        )
        and thread.user_id = (select auth.uid())
        and thread.organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    )
  );
