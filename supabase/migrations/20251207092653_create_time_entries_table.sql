-- ============================================
-- Zeiterfassung (Time Tracking) Feature
-- Single migration for: enum, table, indexes, RLS, trigger
-- ============================================

-- 1. Create enum for time entry status
CREATE TYPE time_entry_status AS ENUM ('pending', 'approved', 'rejected');

-- 2. Create time_entries table
CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('clock_in', 'clock_out')),
  timestamp timestamptz NOT NULL,
  is_manual boolean NOT NULL DEFAULT false,
  status time_entry_status NOT NULL DEFAULT 'approved',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Create indexes for efficient queries
CREATE INDEX idx_time_entries_user_org_ts ON time_entries(user_id, organization_id, timestamp);
CREATE INDEX idx_time_entries_org_ts ON time_entries(organization_id, timestamp);
CREATE INDEX idx_time_entries_org_status ON time_entries(organization_id, status);

-- 4. Create updated_at trigger function (if not exists) and trigger
CREATE OR REPLACE FUNCTION update_time_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_time_entries_updated_at();

-- 5. Enable RLS
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- 6. SELECT policy: Users can view entries based on their role
-- - Admin: all entries in org
-- - Manager: own entries + entries of roles below them (accountant, secretary, employee)
-- - Others: own entries only
CREATE POLICY "Users can view permitted time entries"
ON time_entries FOR SELECT
USING (
  organization_id IN (SELECT get_user_org_ids(auth.uid()))
  AND (
    -- User can always see their own entries
    user_id = auth.uid()
    OR
    -- Admin can see all entries in their org
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = time_entries.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'admin'
    )
    OR
    -- Manager can see entries of roles below them (not other managers/admin)
    EXISTS (
      SELECT 1 FROM organization_members om_caller
      JOIN organization_members om_target ON om_target.user_id = time_entries.user_id
        AND om_target.organization_id = time_entries.organization_id
      WHERE om_caller.organization_id = time_entries.organization_id
      AND om_caller.user_id = auth.uid()
      AND om_caller.role = 'manager'
      AND om_target.role IN ('accountant', 'secretary', 'employee')
    )
  )
);

-- 7. Block direct INSERT from clients (use server actions with service role)
CREATE POLICY "Block direct insert"
ON time_entries FOR INSERT
WITH CHECK (false);

-- 8. Block direct UPDATE from clients (use server actions with service role)
CREATE POLICY "Block direct update"
ON time_entries FOR UPDATE
USING (false);

-- 9. Block direct DELETE from clients (use server actions with service role)
CREATE POLICY "Block direct delete"
ON time_entries FOR DELETE
USING (false);