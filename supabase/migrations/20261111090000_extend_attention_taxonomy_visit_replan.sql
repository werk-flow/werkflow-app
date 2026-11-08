-- The attention identity union in lib/attention/types.ts and these checks stay
-- in step: the planner's „Einsatz umplanen“ task (planning_visit_replan), whose
-- identity is the visit's assignment of a person an approved vacation takes away.
-- Expand-only: every earlier value stays allowed.
-- @destructive: after release e713fa96: the constraint returns below with every earlier source type and one new one
alter table public.attention_read_states
  drop constraint attention_read_states_source_type_check;
-- @destructive: after release e713fa96: that build writes only source types this list keeps
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request', 'planning_visit_replan'
    ])
  );
-- @destructive: after release e713fa96: the constraint returns below with every earlier source type and one new one
alter table public.attention_events
  drop constraint attention_events_source_type_check;
-- @destructive: after release e713fa96: that build writes only source types this list keeps
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request', 'planning_visit_replan'
    ])
  );
