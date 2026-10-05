-- Planning choices are independent bounded reads, never a whole-company preload.
CREATE OR REPLACE FUNCTION public.search_planning_options(
  p_organization_id uuid,
  p_kind text,
  p_query text DEFAULT '',
  p_offset integer DEFAULT 0,
  p_selected_ids uuid[] DEFAULT '{}',
  p_default_user_ids uuid[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  WITH candidates AS NOT MATERIALIZED (
    SELECT employee.id AS value,
      COALESCE(NULLIF(btrim(concat_ws(' ',
        COALESCE(NULLIF(btrim(profile.first_name), ''), employee.first_name),
        COALESCE(NULLIF(btrim(profile.last_name), ''), employee.last_name))), ''),
        employee.employee_number, 'Unbenannt') AS label,
      CASE WHEN employee.user_id IS NULL THEN 'Ohne App-Zugang' ELSE employee.employee_number END AS description,
      employee.user_id AS "userId",
      (employee.exit_date IS NULL OR employee.exit_date >= (now() AT TIME ZONE 'Europe/Berlin')::date) AS eligible
    FROM public.employee_records employee
    LEFT JOIN public.profiles profile ON profile.id = employee.user_id
    WHERE p_kind = 'employees' AND employee.organization_id = p_organization_id
    UNION ALL
    SELECT job.id,
      concat_ws(' · ', NULLIF(job.job_number, ''),
        COALESCE(NULLIF(btrim(job.title), ''), NULLIF(btrim(job.description), ''), 'Ohne Titel')),
      project.name, NULL::uuid, job.status <> 'fertig'
    FROM public.jobs job
    LEFT JOIN public.projects project ON project.id = job.project_id AND project.organization_id = p_organization_id
    WHERE p_kind = 'jobs' AND job.organization_id = p_organization_id
    UNION ALL
    SELECT team.id, team.name, NULL::text, NULL::uuid, team.dissolved_at IS NULL
    FROM public.teams team
    WHERE p_kind = 'teams' AND team.organization_id = p_organization_id
  ), page AS MATERIALIZED (
    SELECT * FROM candidates
    WHERE eligible AND position(lower(btrim(p_query)) IN lower(label || ' ' || COALESCE(description, ''))) > 0
    ORDER BY lower(label), value
    LIMIT 51 OFFSET greatest(p_offset, 0)
  ), choices AS (
    SELECT * FROM page ORDER BY lower(label), value LIMIT 50
  ), selected AS (
    SELECT * FROM candidates
    WHERE value = ANY(p_selected_ids) OR (eligible AND "userId" = ANY(p_default_user_ids))
    ORDER BY lower(label), value
  )
  SELECT jsonb_build_object(
    'options', COALESCE((SELECT jsonb_agg(to_jsonb(choices) - 'eligible' ORDER BY lower(label), value) FROM choices), '[]'::jsonb),
    'selected', COALESCE((SELECT jsonb_agg(to_jsonb(selected) - 'eligible' ORDER BY lower(label), value) FROM selected), '[]'::jsonb),
    'hasMore', (SELECT count(*) > 50 FROM page)
  );
$function$;
REVOKE ALL ON FUNCTION public.search_planning_options(uuid, text, text, integer, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_planning_options(uuid, text, text, integer, uuid[], uuid[]) TO service_role;
