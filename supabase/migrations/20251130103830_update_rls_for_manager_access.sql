-- Create helper function to get org IDs where user is admin or manager
CREATE OR REPLACE FUNCTION get_user_admin_or_manager_org_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id 
  FROM public.organization_members 
  WHERE user_id = p_user_id 
    AND role IN ('admin', 'manager');
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_admin_or_manager_org_ids(uuid) TO authenticated;

-- Drop the old policy for viewing invites
DROP POLICY IF EXISTS "Admins can view org invites" ON public.organization_invites;

-- Create new policy that allows both admins and managers to view invites
CREATE POLICY "Admins and managers can view org invites"
ON public.organization_invites
FOR SELECT
TO authenticated
USING (
  organization_id IN (SELECT get_user_admin_or_manager_org_ids(auth.uid()))
);