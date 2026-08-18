DROP POLICY IF EXISTS "Admins can view all change requests" ON public.entry_change_requests;

CREATE POLICY "Admins and managers can view change requests"
  ON public.entry_change_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM organization_members
      WHERE organization_members.organization_id = entry_change_requests.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role IN ('admin', 'manager')
    )
  );