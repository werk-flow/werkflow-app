// The SQL tests of a maintenance visit's due work, completion and follow-up,
// run as one group (`sql:maintenance-visit-next-actions` in test-groups.ts).
// The list lives here so the group stays one line under test-groups.ts's
// line cap (werk-flow/werkflow-planning#502).
export const MAINTENANCE_VISIT_SQL_FILES: readonly string[] = [
  'maintenance_missed_visits.sql',
  'maintenance_visit_next_actions.sql',
  'maintenance_service_reports.sql',
  'maintenance_open_findings.sql',
];

/** The areas whose changes select the group. */
export const MAINTENANCE_VISIT_SQL_SCOPES: readonly string[] = ['service', 'work', 'attention', 'documents'];
