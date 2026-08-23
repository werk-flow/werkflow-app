alter table public.work_templates
  drop constraint work_templates_draft_version_id_fkey,
  drop constraint work_templates_current_published_version_id_fkey;
alter table public.work_template_versions
  drop constraint work_template_versions_template_id_fkey;

alter table public.work_template_versions
  add constraint work_template_versions_template_id_fkey
  foreign key (template_id) references public.work_templates(id) on delete cascade;
alter table public.work_templates
  add constraint work_templates_draft_version_id_fkey
  foreign key (draft_version_id) references public.work_template_versions(id) on delete set null,
  add constraint work_templates_current_published_version_id_fkey
  foreign key (current_published_version_id) references public.work_template_versions(id) on delete set null;
