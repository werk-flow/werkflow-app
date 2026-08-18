
-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view members of their orgs" ON public.organization_members;

-- Create a helper function that checks if a user is a member of an organization
-- This function uses SECURITY DEFINER to bypass RLS and avoid recursion
CREATE OR REPLACE FUNCTION public.is_member_of_org(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = p_user_id AND organization_id = p_org_id
  );
$$;

-- Create a function to get all organization IDs a user belongs to
-- This also uses SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.get_user_org_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
STABLE
AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = p_user_id;
$$;

-- Create the new policy using the helper function
CREATE POLICY "Users can view members of their orgs"
ON public.organization_members FOR SELECT
USING (
  -- User can see members of any organization they belong to
  organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
);
