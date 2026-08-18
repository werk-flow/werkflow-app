-- Add invited_role column to organization_invites table
-- This tracks what role the user will receive when they accept the invitation
ALTER TABLE public.organization_invites 
ADD COLUMN IF NOT EXISTS invited_role org_role NOT NULL DEFAULT 'employee';