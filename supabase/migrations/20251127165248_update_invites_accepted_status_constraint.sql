
-- Drop the old constraint
ALTER TABLE public.organization_invites DROP CONSTRAINT IF EXISTS invites_accepted_status;

-- Add the updated constraint that includes 'cancelled' status
ALTER TABLE public.organization_invites ADD CONSTRAINT invites_accepted_status CHECK (
  (
    (status = 'accepted'::invite_status AND accepted_at IS NOT NULL)
    OR
    (status IN ('pending'::invite_status, 'expired'::invite_status, 'cancelled'::invite_status) AND accepted_at IS NULL)
  )
);
