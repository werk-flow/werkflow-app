alter table public.email_change_challenges
  add column if not exists new_email_code_hash text,
  add column if not exists new_email_code_expires_at timestamp with time zone,
  add column if not exists new_email_last_sent_at timestamp with time zone,
  add column if not exists new_email_attempt_count integer not null default 0;