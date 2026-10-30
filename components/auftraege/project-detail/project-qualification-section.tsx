'use client';

import { useState, type ReactElement } from 'react';
import { Award, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import { setProjectCapabilityRequirements } from '@/lib/qualifications/requirement-actions';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

type Requirement = { id: string; capability_id: string; require_confirmation: boolean };

/** Busy slot for the section-level add; removals use the requirement id. */
const ADD_BUSY_ID = 'add';
const CAPABILITY_FIELD_ID = 'project-capability';
const CAPABILITY_REQUIRED_MESSAGE = 'Bitte wähle eine Qualifikation aus.';
const NO_CAPABILITIES: CapabilityDefinition[] = [];
const NO_REQUIREMENTS: Requirement[] = [];

function toRequirementInput(item: Requirement): { capabilityId: string; requireConfirmation: boolean } {
  return { capabilityId: item.capability_id, requireConfirmation: item.require_confirmation };
}

export function ProjectQualificationSection({ projectId }: { projectId: string }): ReactElement {
  const [selectedId, setSelectedId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { run: runSave, isBusy, anyBusy: saving } = useBusyIds();
  const planned = useClientRead({
    read: (signal) => readInBackground('project-capability-requirements', { projectId }, signal),
    deps: [projectId],
    failureMessage: 'Die Qualifikationen konnten nicht geladen werden.',
  });
  // The next save sends the shown list as its expectation, so the controls wait for the reload too.
  const anyBusy = saving || planned.loading;
  const capabilities = planned.data?.data.capabilities ?? NO_CAPABILITIES;
  const requirements = planned.data?.data.requirements ?? NO_REQUIREMENTS;
  // Every save replaces the whole requirement list, so saves stay mutually
  // exclusive (`anyBusy` disables the controls); `busyId` only chooses where
  // the spinner shows. Never rejects: every failure lands in `saveError`.
  async function save(
    busyId: string,
    next: Array<{ capabilityId: string; requireConfirmation: boolean }>,
  ): Promise<boolean> {
    setSaveError(null);
    try {
      const result = await runSave(busyId, () =>
        setProjectCapabilityRequirements({
          projectId,
          requirements: next,
          expectedRequirements: requirements.map(toRequirementInput),
        }),
      );
      if (!result.success) {
        setSaveError(
          result.error === 'conflict'
            ? 'Die Qualifikationen wurden zwischenzeitlich geändert. Lade die Seite neu und prüfe deine Auswahl.'
            : 'Die Qualifikationsanforderungen konnten nicht gespeichert werden.',
        );
        return false;
      }
      // The section keeps the saved list on screen while the reload runs.
      planned.reload();
      return true;
    } catch {
      setSaveError('Die Qualifikationsanforderungen konnten nicht gespeichert werden.');
      return false;
    }
  }
  if (planned.failure) {
    return <SectionError title="Geplante Qualifikationen" failure={planned.failure} />;
  }
  if (!planned.data) {
    return (
      <Card className="gap-4 p-4" role="status" aria-busy="true">
        <span className="sr-only">Qualifikationen werden geladen.</span>
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-10 w-full rounded-md" />
      </Card>
    );
  }
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  return (
    <Card className="gap-4 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Award className="size-4" />
          Geplante Qualifikationen
          <InlinePending active={isBusy(ADD_BUSY_ID)} label="Qualifikation wird gespeichert" />
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Projektweite Rollenplanung; noch keine Einsatz- oder Terminentscheidung.
        </p>
      </div>
      <ErrorText>{saveError}</ErrorText>
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Qualifikation hinzufügen"
          htmlFor={CAPABILITY_FIELD_ID}
          className="min-w-56 flex-1"
          error={attempted && !selectedId ? CAPABILITY_REQUIRED_MESSAGE : undefined}
        >
          <SearchableSelect
            id={CAPABILITY_FIELD_ID}
            options={capabilities
              .filter((capability) => !requirements.some((item) => item.capability_id === capability.id))
              .map((capability) => ({ value: capability.id, label: capability.name }))}
            value={selectedId}
            onChange={setSelectedId}
            searchPlaceholder="Qualifikation suchen…"
            emptyMessage="Keine weitere Qualifikation"
            disabled={anyBusy}
          />
        </Field>
        <label className="flex h-9 items-center gap-2">
          <Checkbox
            checked={requireConfirmation}
            disabled={anyBusy}
            onCheckedChange={(checked) => setRequireConfirmation(checked === true)}
          />
          Bestätigung nötig
        </label>
        <Button
          type="button"
          variant="outline"
          aria-label="Qualifikation hinzufügen"
          disabled={anyBusy}
          onClick={async () => {
            if (!selectedId) {
              setAttempted(true);
              focusFirstInvalidField({ [CAPABILITY_FIELD_ID]: CAPABILITY_REQUIRED_MESSAGE });
              return;
            }
            const saved = await save(ADD_BUSY_ID, [
              ...requirements.map(toRequirementInput),
              { capabilityId: selectedId, requireConfirmation },
            ]);
            if (saved) {
              setAttempted(false);
              setSelectedId('');
              setRequireConfirmation(false);
            }
          }}
        >
          Hinzufügen
        </Button>
      </div>
      {requirements.length === 0 ? (
        <EmptyState size="compact" title="Keine Qualifikationen geplant." />
      ) : (
        requirements.map((requirement) => {
          const capabilityName = byId.get(requirement.capability_id)?.name ?? 'Unbekannte Qualifikation';
          return (
            <div
              key={requirement.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{capabilityName}</p>
                {requirement.require_confirmation && (
                  <p className="text-xs text-muted-foreground">Bestätigung erforderlich</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <InlinePending active={isBusy(requirement.id)} label="Qualifikation wird entfernt" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={anyBusy}
                  aria-label={`${capabilityName} entfernen`}
                  onClick={() =>
                    void save(
                      requirement.id,
                      requirements.filter((item) => item.id !== requirement.id).map(toRequirementInput),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}
