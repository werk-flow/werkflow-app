alter table public.work_template_items
  drop constraint work_template_items_version_id_fkey,
  add constraint work_template_items_version_id_fkey
    foreign key (version_id) references public.work_template_versions(id) on delete cascade;

alter table public.work_template_item_evidence_requirements
  drop constraint work_template_item_evidence_requirements_version_id_fkey,
  add constraint work_template_item_evidence_requirements_version_id_fkey
    foreign key (version_id) references public.work_template_versions(id) on delete cascade;

alter table public.work_template_item_dependencies
  drop constraint work_template_item_dependencies_version_id_fkey,
  add constraint work_template_item_dependencies_version_id_fkey
    foreign key (version_id) references public.work_template_versions(id) on delete cascade;

alter table public.work_template_material_lines
  drop constraint work_template_material_lines_version_id_fkey,
  add constraint work_template_material_lines_version_id_fkey
    foreign key (version_id) references public.work_template_versions(id) on delete cascade;

alter table public.work_template_capability_requirements
  drop constraint work_template_capability_requirements_version_id_fkey,
  add constraint work_template_capability_requirements_version_id_fkey
    foreign key (version_id) references public.work_template_versions(id) on delete cascade;

alter table public.work_template_applications
  drop constraint work_template_applications_template_id_fkey,
  drop constraint work_template_applications_template_version_id_fkey,
  add constraint work_template_applications_template_id_fkey
    foreign key (template_id) references public.work_templates(id) on delete cascade,
  add constraint work_template_applications_template_version_id_fkey
    foreign key (template_version_id) references public.work_template_versions(id) on delete cascade;

alter table public.work_template_events
  drop constraint work_template_events_template_id_fkey,
  drop constraint work_template_events_template_version_id_fkey,
  drop constraint work_template_events_application_id_fkey,
  add constraint work_template_events_template_id_fkey
    foreign key (template_id) references public.work_templates(id) on delete cascade,
  add constraint work_template_events_template_version_id_fkey
    foreign key (template_version_id) references public.work_template_versions(id) on delete cascade,
  add constraint work_template_events_application_id_fkey
    foreign key (application_id) references public.work_template_applications(id) on delete cascade;

alter table public.job_capability_requirement_origins
  drop constraint job_capability_requirement_or_source_work_template_require_fkey,
  add constraint job_capability_requirement_or_source_work_template_require_fkey
    foreign key (source_work_template_requirement_id)
    references public.work_template_capability_requirements(id) on delete cascade;
