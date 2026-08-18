-- Add 'cancelled' to the invite_status enum
ALTER TYPE public.invite_status ADD VALUE IF NOT EXISTS 'cancelled';