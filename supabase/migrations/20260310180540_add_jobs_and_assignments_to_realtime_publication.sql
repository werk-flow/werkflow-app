ALTER TABLE public.jobs REPLICA IDENTITY FULL;
ALTER TABLE public.job_assignments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_assignments;