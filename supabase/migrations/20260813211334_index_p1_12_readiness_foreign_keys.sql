-- P1-12 readiness reads job material demand by job; this FK was flagged
-- unindexed by the Performance Advisor and is now consumed by a P1-12 query.
create index if not exists job_material_lines_job_id_idx
  on job_material_lines (job_id);