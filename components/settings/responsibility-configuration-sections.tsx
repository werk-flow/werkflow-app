import { formatDelegationDate, personName } from '@/components/settings/responsibility-display';
import { Checkbox } from '@/components/ui/checkbox';
import type { ResponsibilityPreview } from '@/lib/responsibilities/actions';
import {
  formatResponsibilityPersonName,
  type OrganizationResponsibility,
  type ResponsibilityPerson,
} from '@/lib/responsibilities/types';
import { ROLE_LABELS } from '@/lib/roles';

export function ResponsibilityHolderChecklist({
  responsibility,
  people,
  selectedIds,
  onToggle,
}: {
  responsibility: OrganizationResponsibility;
  people: ResponsibilityPerson[];
  selectedIds: string[];
  onToggle: (employeeRecordId: string, nextChecked: boolean | 'indeterminate') => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Personen auswählen</legend>
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
        {people.map((person) => {
          const checked = selectedIds.includes(person.employeeRecordId);
          const checkboxId = `${responsibility}-${person.employeeRecordId}`;
          return (
            <label
              key={person.employeeRecordId}
              htmlFor={checkboxId}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
            >
              <Checkbox
                id={checkboxId}
                checked={checked}
                onCheckedChange={(nextChecked) => onToggle(person.employeeRecordId, nextChecked)}
              />
              <span className="min-w-0 text-sm">
                <span className="font-medium">{formatResponsibilityPersonName(person)}</span>{' '}
                <span className="text-muted-foreground">· {ROLE_LABELS[person.role]}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ResponsibilityEffectPreview({
  preview,
  people,
}: {
  preview: ResponsibilityPreview;
  people: ResponsibilityPerson[];
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="effective-access-preview">
      <div>
        <p className="text-sm font-medium">Wirkung ab heute</p>
        <p className="text-xs text-muted-foreground">
          {formatDelegationDate(preview.businessDate)} · erst nach Bestätigung
        </p>
      </div>
      <PreviewNames
        label="Erhält Zugriff"
        testId="preview-gained"
        ids={preview.gainedHolderIds}
        people={people}
        emptyLabel="Niemand zusätzlich"
      />
      <PreviewNames
        label="Verliert Zugriff"
        testId="preview-lost"
        ids={preview.lostHolderIds}
        people={people}
        emptyLabel="Niemand"
      />
      <PreviewNames
        label="Danach verantwortlich"
        testId="preview-effective"
        ids={preview.effectiveHolderIds}
        people={people}
      />
    </div>
  );
}

function PreviewNames({
  label,
  testId,
  ids,
  people,
  emptyLabel = 'Niemand',
}: {
  label: string;
  testId: string;
  ids: string[];
  people: ResponsibilityPerson[];
  emptyLabel?: string;
}) {
  return (
    <div className="text-sm" data-testid={testId}>
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">
        {ids.length > 0 ? ids.map((id) => personName(people, id)).join(', ') : emptyLabel}
      </p>
    </div>
  );
}
