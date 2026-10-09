'use client';

import { DatePicker } from '@/components/ui/date-picker';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import { WorkTemplatePicker } from '@/components/arbeitsvorlagen/work-template-picker';
import { formatSiteAddress } from '@/lib/clients/types';
import type { JobPriority } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
import { ClientSelectWithCreate, type ClientSelectItem } from '../shared/client-select-with-create';
import { EmployeeMultiSelect, type OrgMemberOption } from '../shared/employee-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';
import { SiteContactFields } from '../shared/site-contact-fields';
import { JOB_PRIORITY_OPTIONS } from './job-form-options';
import type { CreateJobForm } from './use-create-job-form';

/** Number, title, description and work template. */
export function CreateJobBasicsFields({ form }: { form: CreateJobForm }) {
  const {
    jobNumber,
    setJobNumber,
    jobNumberError,
    setJobNumberError,
    showJobNumberError,
    title,
    setTitle,
    description,
    setDescription,
    contentError,
    setContentError,
    showContentError,
    templateVersionId,
    setTemplateVersionId,
    formDisabled,
  } = form;

  return (
    <>
      <Field
        label="Auftragsnummer"
        htmlFor="job-number"
        required
        error={showJobNumberError ? jobNumberError : null}
      >
        <Input
          placeholder="z.B. AUF-2026-001"
          value={jobNumber}
          onChange={(e) => {
            setJobNumber(e.target.value);
            if (jobNumberError) setJobNumberError(null);
          }}
          disabled={formDisabled}
        />
      </Field>

      <Field label="Titel" htmlFor="job-title">
        <Input
          placeholder="z.B. Heizung reparieren"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (contentError && e.target.value.trim()) setContentError(null);
          }}
          disabled={formDisabled}
          aria-invalid={showContentError ? true : undefined}
        />
      </Field>

      <Field label="Beschreibung" htmlFor="job-description" error={showContentError ? contentError : null}>
        <Textarea
          placeholder="Optionale Beschreibung des Auftrags…"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (contentError && e.target.value.trim()) setContentError(null);
          }}
          disabled={formDisabled}
        />
      </Field>

      <WorkTemplatePicker
        targetType="job"
        value={templateVersionId}
        onChange={setTemplateVersionId}
        disabled={formDisabled}
      />
    </>
  );
}

type CreateJobAssignmentFieldsProps = {
  form: CreateJobForm;
  selectedClient: ClientSelectItem | undefined;
  readOnlyProject: boolean | undefined;
};

/** The "Zuordnung" group: customer, project and priority. */
export function CreateJobAssignmentFields({
  form,
  selectedClient,
  readOnlyProject,
}: CreateJobAssignmentFieldsProps) {
  const {
    clientId,
    handleClientChange,
    isClientLocked,
    lockedClientLabel,
    projectSearch,
    projectId,
    handleProjectChange,
    isLoadingProjectDefaults,
    projectDefaultsLoadFailed,
    retryProjectDefaults,
    priority,
    setPriority,
    formDisabled,
    projectSelectionDisabled,
  } = form;

  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zuordnung</p>

      <Field label="Kunde" htmlFor="job-client">
        <ClientSelectWithCreate
          selectedClient={selectedClient}
          value={clientId}
          onValueChange={handleClientChange}
          disabled={projectSelectionDisabled}
          readOnly={isClientLocked}
          readOnlyLabel={lockedClientLabel}
        />
      </Field>

      <Field label="Projekt" htmlFor="job-project">
        <SearchableSelect
          options={projectSearch.options}
          onSearchChange={projectSearch.onSearchChange}
          loading={projectSearch.loading}
          loadError={projectSearch.loadError}
          onRetryLoad={projectSearch.onRetryLoad}
          onLoadMore={projectSearch.onLoadMore}
          value={projectId}
          onChange={handleProjectChange}
          placeholder="Kein Projekt"
          searchPlaceholder="Projekt suchen…"
          emptyMessage="Kein Projekt gefunden"
          disabled={formDisabled}
          allowNone
          noneLabel="Kein Projekt"
          readOnly={readOnlyProject}
        />
        <OptionsLoadError
          error={projectDefaultsLoadFailed ? 'Die Projektvorgaben konnten nicht geladen werden.' : null}
          onRetry={retryProjectDefaults}
          retrying={isLoadingProjectDefaults}
        />
      </Field>

      <Field label="Priorität" htmlFor="job-priority">
        <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority)} disabled={formDisabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOB_PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

type CreateJobPlanningFieldsProps = {
  form: CreateJobForm;
  members: OrgMemberOption[];
};

/** The "Planung" group: date, time, duration, site, contact, location, assignees and effort. */
export function CreateJobPlanningFields({ form, members }: CreateJobPlanningFieldsProps) {
  const {
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    estimatedHours,
    setEstimatedHours,
    clientId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    location,
    setLocation,
    selectedEmployees,
    setSelectedEmployees,
    setAssignmentTeamSourceId,
    plannedWorkingHours,
    setPlannedWorkingHours,
    plannedWorkingTouched,
    setPlannedWorkingTouched,
    formDisabled,
    projectSelectionDisabled,
    siteContactDisabled,
  } = form;

  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planung</p>

      <Field label="Geplantes Datum" htmlFor="job-date">
        <DatePicker value={plannedDate} onChange={setPlannedDate} disabled={formDisabled} />
      </Field>

      <Field label="Geplante Uhrzeit" htmlFor="job-time">
        <TimeInput value={plannedTime} onChange={setPlannedTime} disabled={formDisabled} />
      </Field>

      <Field label="Geschätzte Dauer (Stunden)" htmlFor="job-duration">
        <DurationHoursInput
          id="job-duration"
          placeholder="z.B. 2.5"
          value={estimatedHours}
          onChange={setEstimatedHours}
          disabled={formDisabled}
        />
      </Field>

      <SiteContactFields
        clientId={clientId}
        siteId={siteId}
        contactId={contactId}
        onSiteChange={(nextSiteId, site) => {
          setSiteId(nextSiteId);
          // The site's current address becomes the job's recorded Ort;
          // it stays a text snapshot afterwards.
          if (site) {
            const address = formatSiteAddress(site);
            if (address) setLocation(address);
          }
        }}
        onContactChange={setContactId}
        disabled={siteContactDisabled}
        idPrefix="job"
      />

      <Field label="Ort" htmlFor="job-location">
        <Input
          placeholder="Adresse oder Ort"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={formDisabled}
        />
      </Field>

      <Field label="Mitarbeiter" htmlFor="job-employees">
        <EmployeeMultiSelect
          members={members}
          selectedIds={selectedEmployees}
          onSelectionChange={setSelectedEmployees}
          assessedForDate={plannedDate ? toLocalDateString(plannedDate) : null}
          onTeamApplied={setAssignmentTeamSourceId}
          disabled={projectSelectionDisabled}
        />
      </Field>

      <Field
        label="Geplanter Arbeitsaufwand (Stunden)"
        htmlFor="job-planned-working"
        description={
          !plannedWorkingTouched
            ? 'Wird automatisch aus geschätzter Dauer × Mitarbeiter vorbelegt.'
            : 'Manuell angepasst. Weitere Änderungen an Dauer oder Mitarbeitern überschreiben diesen Wert nicht.'
        }
      >
        <DurationHoursInput
          id="job-planned-working"
          placeholder="z.B. 5"
          value={plannedWorkingHours}
          onChange={(value) => {
            setPlannedWorkingTouched(true);
            setPlannedWorkingHours(value);
          }}
          disabled={formDisabled}
        />
      </Field>
    </>
  );
}
