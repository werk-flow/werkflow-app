-- Composite index for the frequent query: pending change requests by org
-- Replaces two separate single-column indexes for WHERE org_id = X AND status = 'pending'
CREATE INDEX IF NOT EXISTS idx_entry_change_requests_org_status
  ON public.entry_change_requests (organization_id, status);

-- Composite index for per-entry change request lookups with status filter
CREATE INDEX IF NOT EXISTS idx_entry_change_requests_entry_status
  ON public.entry_change_requests (entry_id, status);

-- Index for cross-org open session checks (WHERE user_id = X ORDER BY timestamp)
-- The existing (user_id, organization_id, timestamp) index requires a skip scan;
-- this dedicated index is more efficient for the common getClockStatus pattern.
CREATE INDEX IF NOT EXISTS idx_time_entries_user_ts
  ON public.time_entries (user_id, "timestamp");