'use client';

import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { JobMultiSelect } from '../shared/job-multi-select';
import { ClientSelectWithCreate, type ClientSelectItem } from '../shared/client-select-with-create';
import { SiteContactFields } from '../shared/site-contact-fields';
import { WorkTemplatePicker } from '@/components/arbeitsvorlagen/work-template-picker';
import type { CreateProjectForm } from './use-create-project-form';

type CreateProjectFormFieldsProps = {
  form: CreateProjectForm;
  defaultClient: ClientSelectItem | undefined;
  readOnlyClient: boolean | undefined;
};

export function CreateProjectFormFields({
  form,
  defaultClient,
  readOnlyClient,
}: CreateProjectFormFieldsProps) {
  const {
    name,
    setName,
    description,
    setDescription,
    projectNumber,
    setProjectNumber,
    templateVersionId,
    setTemplateVersionId,
    clientId,
    handleClientChange,
    readOnlyClientLabel,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    plannedStartDate,
    setPlannedStartDate,
    plannedEndDate,
    setPlannedEndDate,
    selectedJobIds,
    setSelectedJobIds,
    jobSearch,
    contentError,
    setContentError,
    showContentError,
    projectNumberError,
    setProjectNumberError,
    showProjectNumberError,
    formDisabled,
  } = form;

  return (
    <>
      <Field
        label="Projektnummer"
        htmlFor="create-project-number"
        required
        error={showProjectNumberError ? projectNumberError : null}
      >
        <Input
          placeholder="z.B. P-2026-001"
          value={projectNumber}
          onChange={(e) => {
            setProjectNumber(e.target.value);
            if (projectNumberError) setProjectNumberError(null);
          }}
          disabled={formDisabled}
        />
      </Field>

      <Field label="Titel" htmlFor="create-project-name">
        <Input
          placeholder="z.B. Sanierung Hauptgebäude"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (contentError && e.target.value.trim()) setContentError(null);
          }}
          disabled={formDisabled}
          aria-invalid={showContentError ? true : undefined}
        />
      </Field>

      <Field
        label="Beschreibung"
        htmlFor="create-project-description"
        error={showContentError ? contentError : null}
      >
        <Textarea
          placeholder="Optionale Beschreibung des Projekts…"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (contentError && e.target.value.trim()) setContentError(null);
          }}
          disabled={formDisabled}
        />
      </Field>

      <WorkTemplatePicker
        targetType="project"
        value={templateVersionId}
        onChange={setTemplateVersionId}
        disabled={formDisabled}
      />

      <Field label="Kunde" htmlFor="create-project-client">
        <ClientSelectWithCreate
          selectedClient={defaultClient}
          value={clientId}
          onValueChange={handleClientChange}
          disabled={formDisabled}
          readOnly={readOnlyClient}
          readOnlyLabel={readOnlyClientLabel}
        />
      </Field>

      <SiteContactFields
        clientId={clientId}
        siteId={siteId}
        contactId={contactId}
        onSiteChange={(nextSiteId) => setSiteId(nextSiteId)}
        onContactChange={setContactId}
        disabled={formDisabled}
        idPrefix="create-project"
      />

      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planung</p>

      <Field label="Geplanter Beginn" htmlFor="create-project-start-date">
        <DatePicker
          value={plannedStartDate}
          onChange={setPlannedStartDate}
          placeholder="Startdatum wählen"
          disabled={formDisabled}
        />
      </Field>

      <Field label="Geplantes Ende" htmlFor="create-project-end-date">
        <DatePicker
          value={plannedEndDate}
          onChange={setPlannedEndDate}
          placeholder="Enddatum wählen"
          disabled={formDisabled}
        />
      </Field>

      <Field label="Aufträge zuweisen" htmlFor="create-project-jobs">
        <JobMultiSelect
          search={jobSearch}
          selectedIds={selectedJobIds}
          onSelectionChange={setSelectedJobIds}
          disabled={formDisabled}
        />
      </Field>
    </>
  );
}
