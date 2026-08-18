create table if not exists public.email_change_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_email text not null,
  status text not null default 'pending_current' check (status in ('pending_current', 'current_verified', 'pending_new')),
  current_email_code_hash text,
  current_email_code_expires_at timestamptz,
  current_email_last_sent_at timestamptz,
  current_email_attempt_count integer not null default 0 check (current_email_attempt_count >= 0),
  current_email_verified_at timestamptz,
  current_email_verified_expires_at timestamptz,
  new_email text,
  new_email_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_change_challenges enable row level security;

comment on table public.email_change_challenges is 'Tracks the inline email change wizard state for authenticated users.';