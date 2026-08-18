
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can view invite by code" ON public.organization_invites;

-- Create a helper function to get user's admin org IDs
CREATE OR REPLACE FUNCTION public.get_user_admin_org_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
STABLE
AS $$
  SELECT id FROM public.organizations WHERE admin_id = p_user_id;
$$;

-- Recreate the admin policy using the helper function
CREATE POLICY "Admins can view org invites"
ON public.organization_invites FOR SELECT
USING (
  organization_id IN (SELECT public.get_user_admin_org_ids(auth.uid()))
);

-- Create a function to look up an invite by code (bypasses RLS)
-- This is safe because the invite_code is a secret token
CREATE OR REPLACE FUNCTION public.get_invite_by_code(p_invite_code text)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  email text,
  invite_code text,
  status text,
  expires_at timestamptz,
  created_at timestamptz,
  accepted_at timestamptz,
  org_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
STABLE
AS $$
  SELECT 
    i.id,
    i.organization_id,
    i.email,
    i.invite_code,
    i.status::text,
    i.expires_at,
    i.created_at,
    i.accepted_at,
    o.name as org_name
  FROM public.organization_invites i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.invite_code = p_invite_code;
$$;

-- Grant execute permission to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION public.get_invite_by_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invite_by_code(text) TO authenticated;
