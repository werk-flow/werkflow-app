-- Add manager and secretary roles to org_role enum
-- Note: PostgreSQL doesn't support adding enum values at specific positions in a transaction
-- We need to add them and they will be appended

ALTER TYPE org_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE org_role ADD VALUE IF NOT EXISTS 'secretary';