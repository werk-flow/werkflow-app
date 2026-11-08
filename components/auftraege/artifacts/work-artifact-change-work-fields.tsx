'use client';

import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Constants } from '@/lib/supabase/database.types';
import { AUTHORIZATION_STATE_LABELS } from './work-artifact-content';
import { TextField, type WorkArtifactContentFieldsProps } from './work-artifact-form-fields';

export function WorkArtifactChangeWorkFields({
  content,
  patchContent,
  fieldState,
}: WorkArtifactContentFieldsProps) {
  return (
    <div className="space-y-4">
      <TextField
        {...fieldState('changeDescription')}
        label="Änderungs-/Regiearbeit"
        value={content.changeDescription}
        onChange={(value) => patchContent({ changeDescription: value })}
        textarea
      />
      <TextField
        {...fieldState('changeReason')}
        label="Grund"
        value={content.changeReason}
        onChange={(value) => patchContent({ changeReason: value })}
        textarea
      />
      <TextField
        {...fieldState('requestedByContext')}
        label="Angefordert durch"
        value={content.requestedByContext}
        onChange={(value) => patchContent({ requestedByContext: value })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Erwartete Arbeitsminuten"
          value={content.expectedLaborMinutes}
          onChange={(value) => patchContent({ expectedLaborMinutes: value })}
        />
        <TextField
          label="Tatsächliche Arbeitsminuten"
          value={content.actualLaborMinutes}
          onChange={(value) => patchContent({ actualLaborMinutes: value })}
        />
      </div>
      <TextField
        label="Erwartetes Material"
        value={content.expectedMaterialSummary}
        onChange={(value) => patchContent({ expectedMaterialSummary: value })}
        textarea
      />
      <TextField
        label="Tatsächliches Material"
        value={content.actualMaterialSummary}
        onChange={(value) => patchContent({ actualMaterialSummary: value })}
        textarea
      />
      <AuthorizationStateField content={content} patchContent={patchContent} />
      <TextField
        label="Terminauswirkung"
        value={content.scheduleImpact}
        onChange={(value) => patchContent({ scheduleImpact: value })}
        textarea
      />
    </div>
  );
}

function AuthorizationStateField({
  content,
  patchContent,
}: Pick<WorkArtifactContentFieldsProps, 'content' | 'patchContent'>) {
  return (
    <Field label="Autorisierungsstand" htmlFor="artifact-authorization-state">
      <Select
        value={content.authorizationState ?? 'not_requested'}
        onValueChange={(value) => {
          const authorizationState = Constants.public.Enums.work_artifact_change_authorization_state.find(
            (candidate) => candidate === value,
          );
          if (authorizationState) patchContent({ authorizationState });
        }}
      >
        <SelectTrigger aria-label="Autorisierungsstand">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(AUTHORIZATION_STATE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
