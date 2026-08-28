create type public.work_handover_package_state as enum (
  'draft', 'released', 'reopened'
);

create type public.work_handover_source_kind as enum (
  'work_artifact_revision', 'document_version', 'child_handover_release'
);

create type public.work_handover_commercial_readiness_state as enum (
  'not_ready', 'ready_for_commercial_review', 'ready_with_exceptions'
);

create type public.work_handover_event_type as enum (
  'draft_saved', 'review_returned', 'release_reviewed', 'released',
  'override_applied', 'handover_withdrawn', 'execution_reopened',
  'successor_created'
);

-- PostgreSQL makes a new enum value usable only after this migration commits.
alter type public.organization_responsibility
  add value if not exists 'work_handover_review';
