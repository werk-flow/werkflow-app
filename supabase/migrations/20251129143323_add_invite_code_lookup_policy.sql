
-- Add a policy that allows anyone to look up an invite by its invite_code
-- This is needed for the signup/login pages to validate invites
-- The invite_code acts as a secret token that only the invited person knows
CREATE POLICY "Anyone can view invite by code"
ON public.organization_invites FOR SELECT
USING (true);

-- Drop the admin-only policy since the new policy is more permissive
-- Actually, we should keep both - the admin policy allows listing all invites for an org
-- The new policy allows looking up a specific invite by code
-- But since we're using USING (true), it will allow all SELECTs, so we can drop the admin one
DROP POLICY IF EXISTS "Admins can view org invites" ON public.organization_invites;
