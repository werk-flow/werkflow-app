// SQL groups whose file lists live here, so each group stays one line under
// test-groups.ts's line cap (werk-flow/werkflow-planning#502).

/** A maintenance visit's due work, completion and follow-up (`sql:maintenance-visit-next-actions`). */
export const MAINTENANCE_VISIT_SQL_FILES: readonly string[] = [
  'maintenance_missed_visits.sql',
  'maintenance_visit_next_actions.sql',
  'maintenance_service_reports.sql',
  'maintenance_open_findings.sql',
];

/** The areas whose changes select the group. */
export const MAINTENANCE_VISIT_SQL_SCOPES: readonly string[] = ['service', 'work', 'attention', 'documents'];

/** An offer's header, content, Positionsarten, sending and Annahme (`sql:offers`). */
export const OFFER_SQL_FILES: readonly string[] = [
  'offers.sql',
  'offers_concurrency.sql',
  'offer_sending.sql',
  'offer_position_types.sql',
  'offer_acceptance.sql',
];

/** Rate limits and WerkFlow KI's threads, turn charges, tool rows and files (`sql:rate-limits`). */
export const RATE_LIMIT_SQL_FILES: readonly string[] = [
  'rate_limits.sql',
  'ai_threads.sql',
  'ai_turn_charges.sql',
  'ai_tool_items.sql',
  'ai_thread_files.sql',
];
