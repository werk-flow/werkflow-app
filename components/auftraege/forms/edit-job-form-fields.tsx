'use client';

import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { TimeInput } from '@/components/ui/time-input';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmployeeMultiSelect, type OrgMemberOption } from '../shared/employee-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';

import { ClientSelectWithCreate } from '../shared/client-select-with-create';
import { SiteContactFields } from '../shared/site-contact-fields';
import { formatSiteAddress } from '@/lib/clients/types';
import type { Client, JobPriority } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
import { JOB_PRIORITY_OPTIONS } from './job-form-options';
import type { EditJobForm } from './use-edit-job-form';

export function EditJobIdentityFields({ form }: { form: EditJobForm }) {
  const {
    jobNumber,
    setJobNumber,
    title,
    setTitle,
    description,
    setDescription,
    contentError,
    setContentError,
    showContentError,
    formDisabled,
  } = form;

  return (
    <>
      <Field label="Auftragsnummer" htmlFor="edit-job-number">
        <Input
          placeholder="z.B. AUF-2026-001"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
          disabled={formDisabled}
        />
      </Field>

      <Field label="Titel" htmlFor="edit-job-title">
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

      <Field
        label="Beschreibung"
        htmlFor="edit-job-description"
        error={showContentError ? contentError : null}
      >
        <Textarea
          placeholder="Optionale Beschreibung…"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (contentError && e.target.value.trim()) setContentError(null);
          }}
          disabled={formDisabled}
        />
      </Field>
    </>
  );
}

type EditJobAssignmentFieldsProps = {
  form: EditJobForm;
  clients: Client[];
};

export function EditJobAssignmentFields({ form, clients }: EditJobAssignmentFieldsProps) {
  const {
    clientId,
    handleClientChange,
    isClientLocked,
    lockedClientLabel,
    projectOptions,
    projectSearch,
    projectId,
    handleProjectChange,
    priority,
    setPriority,
    formDisabled,
  } = form;

  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zuordnung</p>

      <Field label="Kunde" htmlFor="edit-job-client">
        <ClientSelectWithCreate
          clients={clients}
          value={clientId}
          onValueChange={handleClientChange}
          disabled={formDisabled}
          readOnly={isClientLocked}
          readOnlyLabel={lockedClientLabel}
        />
      </Field>

      <Field label="Projekt" htmlFor="edit-job-project">
        <SearchableSelect
          options={projectOptions}
          onSearchChange={projectSearch.onSearchChange}
          loading={projectSearch.loading}
          loadError={projectSearch.loadError}
          onLoadMore={projectSearch.onLoadMore}
          value={projectId}
          onChange={handleProjectChange}
          placeholder="Kein Projekt"
          searchPlaceholder="Projekt suchen…"
          emptyMessage="Kein Projekt gefunden"
          disabled={formDisabled}
          allowNone
          noneLabel="Kein Projekt"
        />
      </Field>

      <Field label="Priorität" htmlFor="edit-job-priority">
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

type EditJobPlanningFieldsProps = {
  form: EditJobForm;
  members: OrgMemberOption[];
};

export function EditJobPlanningFields({ form, members }: EditJobPlanningFieldsProps) {
  const {
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    estimatedHours,
    handleEstimatedHoursChange,
    clientId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    location,
    setLocation,
    isLoadingAssignments,
    assignmentsLoadFailed,
    retryAssignments,
    selectedEmployees,
    handleSelectedEmployeesChange,
    setAssignmentTeamSourceId,
    plannedWorkingTouched,
    setPlannedWorkingTouched,
    autoSyncPlannedWorking,
    plannedWorkingHours,
    setPlannedWorkingHours,
    formDisabled,
  } = form;

  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planung</p>

      <Field label="Geplantes Datum" htmlFor="edit-job-date">
        <DatePicker value={plannedDate} onChange={setPlannedDate} disabled={formDisabled} />
      </Field>

      <Field label="Geplante Uhrzeit" htmlFor="edit-job-time">
        <TimeInput value={plannedTime} onChange={setPlannedTime} disabled={formDisabled} />
      </Field>

      <Field label="Geschätzte Dauer (Stunden)" htmlFor="edit-job-duration">
        <DurationHoursInput
          id="edit-job-duration"
          placeholder="z.B. 2.5"
          value={estimatedHours}
          onChange={handleEstimatedHoursChange}
          disabled={formDisabled}
        />
      </Field>

      <SiteContactFields
        clientId={clientId}
        siteId={siteId}
        contactId={contactId}
        onSiteChange={(nextSiteId, site) => {
          setSiteId(nextSiteId);
          // The site's current address becomes the recorded Ort; it
          // stays a text snapshot afterwards.
          if (site) {
            const address = formatSiteAddress(site);
            if (address) setLocation(address);
          }
        }}
        onContactChange={setContactId}
        disabled={formDisabled}
        idPrefix="edit-job"
      />

      <Field label="Ort" htmlFor="edit-job-location">
        <Input
          placeholder="Adresse oder Ort"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={formDisabled}
        />
      </Field>

      <Field
        label="Mitarbeiter"
        htmlFor="edit-job-employees"
        description={isLoadingAssignments ? 'Zuweisungen werden geladen…' : undefined}
      >
        <EmployeeMultiSelect
          members={members}
          selectedIds={selectedEmployees}
          onSelectionChange={handleSelectedEmployeesChange}
          assessedForDate={plannedDate ? toLocalDateString(plannedDate) : null}
          onTeamApplied={setAssignmentTeamSourceId}
          disabled={formDisabled || isLoadingAssignments}
        />
        <OptionsLoadError
          error={assignmentsLoadFailed ? 'Die aktuellen Zuweisungen konnten nicht geladen werden.' : null}
          onRetry={retryAssignments}
          retrying={isLoadingAssignments}
        />
      </Field>

      <Field
        label="Geplanter Arbeitsaufwand (Stunden)"
        htmlFor="edit-job-planned-working"
        description={
          plannedWorkingTouched
            ? 'Manuell angepasst. Bis zum Schließen dieses Dialogs überschreiben weitere Änderungen an Dauer oder Mitarbeitern diesen Wert nicht.'
            : !autoSyncPlannedWorking
              ? 'Bleibt zunächst beim aktuellen Wert. Änderungen an Dauer oder Mitarbeitern berechnen ihn neu.'
              : 'Wird automatisch aus geschätzter Dauer × Mitarbeiter berechnet.'
        }
      >
        <DurationHoursInput
          id="edit-job-planned-working"
          placeholder="z.B. 5"
          value={plannedWorkingHours}
          onChange={(value) => {
            setPlannedWorkingTouched(true);
            setPlannedWorkingHours(value);
          }}
          disabled={formDisabled || isLoadingAssignments}
        />
      </Field>
    </>
  );
}
