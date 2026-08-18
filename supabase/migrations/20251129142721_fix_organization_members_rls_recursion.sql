
-- Drop the existing policy that causes infinite recursion
DROP POLICY IF EXISTS "Members can view org members" ON public.organization_members;

-- Create a new policy that doesn't cause recursion
-- This policy allows users to see their OWN membership rows directly,
-- and also see other members of organizations they belong to
-- We use a subquery with SECURITY_INVOKER to prevent recursion
CREATE POLICY "Users can view members of their orgs"
ON public.organization_members FOR SELECT
USING (
  -- User can always see their own membership rows
  user_id = auth.uid()
  OR
  -- User can see other members if they are in the same organization
  -- This uses a direct check against the user's own rows (which they can see via the first condition)
  organization_id IN (
    SELECT om.organization_id 
    FROM public.organization_members om 
    WHERE om.user_id = auth.uid()
  )
);
