'use client';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { Input } from '@/components/ui/input';
import { SearchableMultiSelect, SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { usePlanningOptions } from '@/hooks/use-planning-options';
import type { PlanningEntryKind } from '@/lib/calendar/planning-entry-draft';
import type { PlanningConflict } from '@/lib/planning/types';
import { formatGermanDate } from '@/lib/utils';

/** The searchable select props one `usePlanningOptions` picker provides. */
type PlanningOptionsSelect = ReturnType<typeof usePlanningOptions>['select'];

interface PlanningEntryKindFieldsProps {
  entryKind: PlanningEntryKind;
  onEntryKindChange: (entryKind: PlanningEntryKind) => void;
  jobSelect: PlanningOptionsSelect;
  jobId: string;
  jobError: string | undefined;
  onJobIdChange: (jobId: string) => void;
  internalType: string;
  onInternalTypeChange: (internalType: string) => void;
  title: string;
  titleError: string | undefined;
  onTitleChange: (title: string) => void;
}

/** The entry kind toggle with the job picker of a visit or the type and title of an internal entry. */
export function PlanningEntryKindFields({
  entryKind,
  onEntryKindChange,
  jobSelect,
  jobId,
  jobError,
  onJobIdChange,
  internalType,
  onInternalTypeChange,
  title,
  titleError,
  onTitleChange,
}: PlanningEntryKindFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Art des geplanten Termins">
        <Button
          type="button"
          aria-pressed={entryKind === 'job_visit'}
          variant={entryKind === 'job_visit' ? 'secondary' : 'outline'}
          onClick={() => onEntryKindChange('job_visit')}
        >
          Auftragsbesuch
        </Button>
        <Button
          type="button"
          aria-pressed={entryKind === 'internal'}
          variant={entryKind === 'internal' ? 'secondary' : 'outline'}
          onClick={() => onEntryKindChange('internal')}
        >
          Interner Termin
        </Button>
      </div>

      {entryKind === 'job_visit' ? (
        <Field
          label="Auftrag"
          htmlFor="planning-job"
          required
          description="Mehrere Besuche bleiben mit demselben Auftrag verbunden."
          error={jobError ?? jobSelect.loadError}
        >
          <SearchableSelect
            {...jobSelect}
            value={jobId}
            onChange={onJobIdChange}
            placeholder="Auftrag auswählen"
            searchPlaceholder="Auftrag suchen …"
            emptyMessage="Kein Auftrag gefunden"
          />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Art" htmlFor="planning-internal-type">
            <Select value={internalType} onValueChange={onInternalTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal_work">Interne Arbeit</SelectItem>
                <SelectItem value="meeting">Besprechung</SelectItem>
                <SelectItem value="training">Schulung</SelectItem>
                <SelectItem value="other">Sonstiges</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Titel" htmlFor="planning-title" required error={titleError}>
            <Input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="z. B. Teamrunde"
            />
          </Field>
        </div>
      )}
    </>
  );
}

interface PlanningEntryAssignmentFieldsProps {
  employeeSelect: PlanningOptionsSelect;
  employeeRecordIds: string[];
  onEmployeeRecordIdsChange: (employeeRecordIds: string[]) => void;
  teamSelect: PlanningOptionsSelect;
  teamIds: string[];
  onTeamIdsChange: (teamIds: string[]) => void;
  onConflictsChange: (conflicts: PlanningConflict[]) => void;
}

/** The employee and team pickers; a changed assignment clears the shown planning warnings. */
export function PlanningEntryAssignmentFields({
  employeeSelect,
  employeeRecordIds,
  onEmployeeRecordIdsChange,
  teamSelect,
  teamIds,
  onTeamIdsChange,
  onConflictsChange,
}: PlanningEntryAssignmentFieldsProps) {
  return (
    <>
      <Field label="Mitarbeiter" htmlFor="planning-employees" error={employeeSelect.loadError}>
        <SearchableMultiSelect
          {...employeeSelect}
          selectedIds={employeeRecordIds}
          onSelectionChange={(ids) => {
            onEmployeeRecordIdsChange(ids);
            onConflictsChange([]);
          }}
          placeholder="Mitarbeiter zuweisen"
          selectedLabel={(count) => (count === 1 ? '1 Mitarbeiter' : `${count} Mitarbeiter`)}
          searchPlaceholder="Mitarbeiter suchen …"
          emptyMessage="Kein Mitarbeiter gefunden"
        />
      </Field>

      <Field label="Teams" htmlFor="planning-teams" error={teamSelect.loadError}>
        <SearchableMultiSelect
          {...teamSelect}
          selectedIds={teamIds}
          onSelectionChange={(ids) => {
            onTeamIdsChange(ids);
            onConflictsChange([]);
          }}
          placeholder="Teams zuweisen"
          searchPlaceholder="Team suchen …"
          emptyMessage="Kein Team gefunden"
        />
      </Field>
    </>
  );
}

interface PlanningEntryInternalDetailsProps {
  location: string;
  onLocationChange: (location: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
}

/** Optional place and description of an internal entry, folded away by default. */
export function PlanningEntryInternalDetails({
  location,
  onLocationChange,
  description,
  onDescriptionChange,
}: PlanningEntryInternalDetailsProps) {
  return (
    <FormDisclosure className="text-sm">
      <div className="grid gap-3">
        <Field label="Ort" htmlFor="planning-location">
          <Input value={location} onChange={(event) => onLocationChange(event.target.value)} />
        </Field>
        <Field label="Beschreibung" htmlFor="planning-description">
          <Textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} />
        </Field>
      </div>
    </FormDisclosure>
  );
}

interface PlanningEntryConflictWarningProps {
  conflicts: PlanningConflict[];
  overrideReason: string;
  overrideError: string | undefined;
  onOverrideReasonChange: (overrideReason: string) => void;
}

/** The planning warnings of the last check and the reason a deliberate exception needs. */
export function PlanningEntryConflictWarning({
  conflicts,
  overrideReason,
  overrideError,
  onOverrideReasonChange,
}: PlanningEntryConflictWarningProps) {
  return (
    <div
      data-planning-warning
      className="space-y-3 rounded-lg border border-warning/40 bg-warning-soft p-3"
      role="status"
    >
      <div>
        <p className="font-medium">Planungshinweise prüfen</p>
        <p className="text-xs text-muted-foreground">
          Die Hinweise blockieren berechtigte Ausnahmen nicht. Eine bewusste Abweichung benötigt einen Grund.
        </p>
      </div>
      <ul className="space-y-1.5 text-sm">
        {conflicts.map((conflict, index) => (
          <li
            key={`${conflict.kind}-${conflict.employeeRecordId}-${conflict.localDate}-${index}`}
            className="flex gap-2"
          >
            <span aria-hidden="true">•</span>
            <span>
              {conflict.employeeName ? `${conflict.employeeName}: ` : ''}
              {conflict.message}
              {conflict.localDate ? ` (${formatGermanDate(conflict.localDate)})` : ''}
            </span>
          </li>
        ))}
      </ul>
      <Field
        label="Begründung der Abweichung"
        htmlFor="planning-override"
        required
        description="Mindestens 8 Zeichen."
        error={overrideError}
      >
        <Textarea
          value={overrideReason}
          onChange={(event) => onOverrideReasonChange(event.target.value)}
          placeholder="Warum ist diese Planung trotzdem sinnvoll?"
        />
      </Field>
    </div>
  );
}

interface PlanningEntrySubmitFooterProps {
  submitting: boolean;
  /** The default recipient is still resolving; planning before that would drop it. */
  resolvingDefaults: boolean;
  hasConflicts: boolean;
}

/** The one submit; it names the reason step once the check returned warnings. */
export function PlanningEntrySubmitFooter({
  submitting,
  resolvingDefaults,
  hasConflicts,
}: PlanningEntrySubmitFooterProps) {
  return (
    <DialogFooter className="pt-4">
      <Button
        pending={submitting}
        type="submit"
        className="w-full"
        disabled={submitting || resolvingDefaults}
      >
        {submitting
          ? 'Planung wird geprüft …'
          : hasConflicts
            ? 'Mit Begründung planen'
            : 'Planung prüfen und speichern'}
      </Button>
    </DialogFooter>
  );
}
