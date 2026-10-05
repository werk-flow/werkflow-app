'use client';

import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { JobMultiSelect } from '../shared/job-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';
import { ClientSelectWithCreate } from '../shared/client-select-with-create';
import { SiteContactFields } from '../shared/site-contact-fields';
import type { Client } from '@/lib/jobs/types';
import type { EditProjectForm } from './use-edit-project-form';

type EditProjectFormFieldsProps = {
  form: EditProjectForm;
  clients: Client[];
};

export function EditProjectFormFields({ form, clients }: EditProjectFormFieldsProps) {
  const {
    name,
    setName,
    description,
    setDescription,
    projectNumber,
    setProjectNumber,
    clientId,
    handleClientChange,
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
    availableJobs,
    isLoadingJobs,
    jobsLoadError,
    retryJobs,
    contentError,
    setContentError,
    showContentError,
    formDisabled,
  } = form;

  return (
    <>
      <Field label="Titel" htmlFor="edit-project-name">
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

      <Field label="Projektnummer" htmlFor="edit-project-number">
        <Input
          placeholder="z.B. P-2026-001"
          value={projectNumber}
          onChange={(e) => setProjectNumber(e.target.value)}
          disabled={formDisabled}
        />
      </Field>

      <Field
        label="Beschreibung"
        htmlFor="edit-project-description"
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

      <Field label="Kunde" htmlFor="edit-project-client">
        <ClientSelectWithCreate
          clients={clients}
          value={clientId}
          onValueChange={handleClientChange}
          disabled={formDisabled}
        />
      </Field>

      <SiteContactFields
        clientId={clientId}
        siteId={siteId}
        contactId={contactId}
        onSiteChange={(nextSiteId) => setSiteId(nextSiteId)}
        onContactChange={setContactId}
        disabled={formDisabled}
        idPrefix="edit-project"
      />

      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planung</p>

      <Field label="Geplanter Beginn" htmlFor="edit-project-start-date">
        <DatePicker
          value={plannedStartDate}
          onChange={setPlannedStartDate}
          placeholder="Startdatum wählen"
          disabled={formDisabled}
        />
      </Field>

      <Field label="Geplantes Ende" htmlFor="edit-project-end-date">
        <DatePicker
          value={plannedEndDate}
          onChange={setPlannedEndDate}
          placeholder="Enddatum wählen"
          disabled={formDisabled}
        />
      </Field>

      <Field
        label="Zugewiesene Aufträge"
        htmlFor="edit-project-jobs"
        description={isLoadingJobs ? 'Aufträge werden geladen…' : undefined}
      >
        {jobsLoadError ? (
          // A failed load must not read as a project without jobs.
          <OptionsLoadError error={jobsLoadError} onRetry={retryJobs} retrying={isLoadingJobs} />
        ) : (
          <JobMultiSelect
            jobs={availableJobs}
            search={jobSearch}
            selectedIds={selectedJobIds}
            onSelectionChange={setSelectedJobIds}
            disabled={formDisabled || isLoadingJobs}
          />
        )}
      </Field>
    </>
  );
}
