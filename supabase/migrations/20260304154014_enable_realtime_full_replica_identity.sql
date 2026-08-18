ALTER TABLE public.time_entries REPLICA IDENTITY FULL;
ALTER TABLE public.entry_change_requests REPLICA IDENTITY FULL;
ALTER TABLE public.organization_invites REPLICA IDENTITY FULL;

-- Add organization_invites to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_invites;