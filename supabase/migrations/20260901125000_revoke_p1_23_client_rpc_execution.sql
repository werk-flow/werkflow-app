-- Supabase grants newly created public functions directly to anon and
-- authenticated through schema defaults. P1-23 RPCs accept an explicit actor
-- only behind server orchestration, so remove those direct grants explicitly.

revoke execute on function public.create_time_account_policy_version(
  uuid, uuid, text, boolean, date, public.time_absence_treatment,
  public.time_absence_treatment, time, time, jsonb, jsonb, jsonb, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.assign_time_account_policy(
  uuid, uuid, uuid, date, date, text, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.open_time_account(
  uuid, uuid, integer, date, text, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.submit_time_account_adjustment(
  uuid, uuid, bigint, public.time_account_adjustment_kind, integer, date, text, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.decide_time_account_adjustment(
  uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid
) from public, anon, authenticated;
revoke execute on function public.prepare_time_period(
  uuid, uuid, date, date, text, jsonb, jsonb, jsonb, jsonb, uuid, text
) from public, anon, authenticated;
revoke execute on function public.decide_time_period_finding(
  uuid, uuid, uuid, public.time_period_finding_decision, text, uuid
) from public, anon, authenticated;
revoke execute on function public.close_time_period(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.reopen_time_period(
  uuid, uuid, uuid, text, uuid, text
) from public, anon, authenticated;
revoke execute on function public.create_payroll_mapping_version(
  uuid, uuid, jsonb, jsonb, uuid, text
) from public, anon, authenticated;
revoke execute on function public.reserve_payroll_export(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.finalize_payroll_export(
  uuid, uuid, uuid, uuid, text, bigint, uuid
) from public, anon, authenticated;
revoke execute on function public.fail_payroll_export(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke execute on function public.get_time_period_source_fingerprint(
  uuid, uuid
) from public, anon, authenticated;
