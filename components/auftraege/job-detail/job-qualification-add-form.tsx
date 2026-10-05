'use client';

import { useState } from 'react';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import type { JobQualificationDetail } from '@/lib/qualifications/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import type { SaveJobQualificationRequirements } from './job-qualification-coverage-list';

/** Busy slot for the section-level add; removals use the requirement id. */
export const ADD_BUSY_ID = 'add';

const CAPABILITY_FIELD_ID = 'job-qualification-capability';
const CAPABILITY_REQUIRED_MESSAGE = 'Bitte wähle einen Begriff aus.';

type JobQualificationAddFormProps = {
  detail: JobQualificationDetail;
  selectedCapabilityId: string;
  setSelectedCapabilityId: (capabilityId: string) => void;
  requireConfirmation: boolean;
  setRequireConfirmation: (required: boolean) => void;
  anyBusy: boolean;
  saveRequirements: SaveJobQualificationRequirements;
};

export function JobQualificationAddForm({
  detail,
  selectedCapabilityId,
  setSelectedCapabilityId,
  requireConfirmation,
  setRequireConfirmation,
  anyBusy,
  saveRequirements,
}: JobQualificationAddFormProps) {
  const selectedDefinition = detail.capabilities.find((capability) => capability.id === selectedCapabilityId);
  const [attempted, setAttempted] = useState(false);
  const capabilityError = attempted && !selectedCapabilityId ? CAPABILITY_REQUIRED_MESSAGE : undefined;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label="Anforderung hinzufügen"
        htmlFor={CAPABILITY_FIELD_ID}
        className="min-w-56 flex-1"
        error={capabilityError}
      >
        <SearchableSelect
          options={detail.capabilities
            .filter(
              (capability) =>
                !detail.requirements.some((requirement) => requirement.capabilityId === capability.id),
            )
            .map((capability) => ({
              value: capability.id,
              label: capability.name,
            }))}
          value={selectedCapabilityId}
          onChange={(value) => {
            setSelectedCapabilityId(value);
            const definition = detail.capabilities.find((capability) => capability.id === value);
            if (definition?.kind !== 'certification') {
              setRequireConfirmation(false);
            }
          }}
          placeholder="Begriff auswählen"
          searchPlaceholder="Begriff suchen…"
          emptyMessage="Kein Begriff gefunden"
        />
      </Field>
      {selectedDefinition?.kind === 'certification' && (
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id="job-require-confirmation"
            checked={requireConfirmation}
            onCheckedChange={(value) => setRequireConfirmation(value === true)}
          />
          <Label htmlFor="job-require-confirmation">Bestätigung erforderlich</Label>
        </div>
      )}
      <Button
        variant="outline"
        aria-label="Anforderung hinzufügen"
        disabled={anyBusy}
        onClick={async () => {
          if (!selectedCapabilityId) {
            setAttempted(true);
            focusFirstInvalidField({ [CAPABILITY_FIELD_ID]: CAPABILITY_REQUIRED_MESSAGE });
            return;
          }
          const saved = await saveRequirements(ADD_BUSY_ID, [
            ...detail.requirements.map((requirement) => ({
              capabilityId: requirement.capabilityId,
              requireConfirmation: requirement.requireConfirmation,
            })),
            {
              capabilityId: selectedCapabilityId,
              requireConfirmation,
            },
          ]);
          if (saved) {
            setAttempted(false);
            setSelectedCapabilityId('');
            setRequireConfirmation(false);
          }
        }}
      >
        Hinzufügen
      </Button>
    </div>
  );
}
