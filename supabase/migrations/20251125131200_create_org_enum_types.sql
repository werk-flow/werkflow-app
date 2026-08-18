-- Create enum types for organization management

-- Invite status enum
create type public.invite_status as enum ('pending', 'accepted', 'expired');

-- Organization role enum
create type public.org_role as enum ('admin', 'employee', 'accountant');
