
-- Drop the existing policy
DROP POLICY IF EXISTS "Members can view their organizations" ON public.organizations;

-- Create a new policy using the helper function for consistency
CREATE POLICY "Members can view their organizations"
ON public.organizations FOR SELECT
USING (
  id IN (SELECT public.get_user_org_ids(auth.uid()))
);
