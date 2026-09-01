-- P1-23 calculations depend on the organization holiday configuration and
-- closure days. Preserve the existing bounded fingerprint as a private base,
-- then include the complete calendar inputs in the public invariant used by
-- prepare and close.

alter function app_private.compute_p1_23_source_fingerprint(uuid, date, date)
  rename to compute_p1_23_source_fingerprint_base;

create or replace function app_private.compute_p1_23_source_fingerprint(
  p_organization_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(jsonb_build_object(
    'period_sources', app_private.compute_p1_23_source_fingerprint_base(
      p_organization_id,
      p_period_start_date,
      p_period_end_date
    ),
    'holiday_settings', coalesce((
      select jsonb_build_object(
        'holiday_region', settings.holiday_region,
        'holiday_region_history', settings.holiday_region_history
      )
      from public.organization_settings settings
      where settings.organization_id = p_organization_id
    ), '{}'::jsonb),
    'closure_days', coalesce((
      select jsonb_agg(to_jsonb(closure_day) order by closure_day.closure_date, closure_day.id)
      from public.organization_closure_days closure_day
      where closure_day.organization_id = p_organization_id
        and closure_day.closure_date between p_period_start_date and p_period_end_date
    ), '[]'::jsonb)
  )::text, 'sha256'), 'hex');
$$;

revoke all on function app_private.compute_p1_23_source_fingerprint_base(uuid, date, date)
  from public, anon, authenticated;
revoke all on function app_private.compute_p1_23_source_fingerprint(uuid, date, date)
  from public, anon, authenticated;
grant execute on function app_private.compute_p1_23_source_fingerprint_base(uuid, date, date)
  to service_role;
grant execute on function app_private.compute_p1_23_source_fingerprint(uuid, date, date)
  to service_role;

comment on function app_private.compute_p1_23_source_fingerprint(uuid, date, date) is
  'Period-scoped P1-23 source fingerprint including effective organization holiday and closure inputs.';
