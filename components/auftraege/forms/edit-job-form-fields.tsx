'use client';

import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { EmployeeMultiSelect, type OrgMemberOption } from '../shared/employee-multi-select';

import { ClientSelectWithCreate, type ClientSelectItem } from '../shared/client-select-with-create';
import { SiteContactFields } from '../shared/site-contact-fields';
import { formatSiteAddress } from '@/lib/clients/types';
import { toLocalDateString } from '@/lib/utils';
import { JOB_PRIORITY_OPTIONS } from './job-form-options';
import { EditJobScheduleFields } from './edit-job-schedule';
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
  selectedClient: ClientSelectItem | null;
};

export function EditJobAssignmentFields({ form, selectedClient }: EditJobAssignmentFieldsProps) {
  const {
    clientId,
    handleClientChange,
    isClientLocked,
    lockedClientLabel,
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
          selectedClient={selectedClient}
          value={clientId}
          onValueChange={handleClientChange}
          disabled={formDisabled}
          readOnly={isClientLocked}
          readOnlyLabel={lockedClientLabel}
        />
      </Field>

      <Field label="Projekt" htmlFor="edit-job-project">
        <SearchableSelect
          options={projectSearch.options}
          onSearchChange={projectSearch.onSearchChange}
          loading={projectSearch.loading}
          loadFailure={projectSearch.loadFailure}
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
        <Select
          value={priority}
          onValueChange={(v) => {
            const option = JOB_PRIORITY_OPTIONS.find((candidate) => candidate.value === v);
            if (option) setPriority(option.value);
          }}
          disabled={formDisabled}
        >
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
  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planung</p>

      <EditJobScheduleFields form={form} />

      <EditJobSiteFields form={form} />

      <EditJobTeamFields form={form} members={members} />
    </>
  );
}

function EditJobSiteFields({ form }: { form: EditJobForm }) {
  const { clientId, siteId, setSiteId, contactId, setContactId, location, setLocation, formDisabled } = form;

  return (
    <>
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
    </>
  );
}

function EditJobTeamFields({ form, members }: EditJobPlanningFieldsProps) {
  const {
    plannedDate,
    isLoadingAssignments,
    assignmentsFailure,
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
        {assignmentsFailure && <SectionError failure={assignmentsFailure} />}
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
