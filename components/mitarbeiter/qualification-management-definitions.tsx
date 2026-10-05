'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createCapability, retireCapabilityDefinition } from '@/lib/qualifications/actions';
import {
  getCapabilityKindLabel,
  type CapabilityKind,
  type QualificationWorkspace,
} from '@/lib/qualifications/types';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { describeFailure } from '@/lib/action-messages';

type QualificationManagementDefinitionFormProps = {
  pendingAction: string | null;
  setPendingAction: (action: string | null) => void;
  refresh: () => void;
};

export function QualificationManagementDefinitionForm({
  pendingAction,
  setPendingAction,
  refresh,
}: QualificationManagementDefinitionFormProps) {
  const { showBanner } = useBanner();
  const [kind, setKind] = useState<CapabilityKind>('skill');
  const [definitionName, setDefinitionName] = useState('');
  const [warningDays, setWarningDays] = useState('30');
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [definitionFieldErrors, setDefinitionFieldErrors] = useState<{
    name?: string | undefined;
    warningDays?: string | undefined;
  }>({});

  return (
    <Card className="grid gap-3 p-4 md:grid-cols-[180px_1fr_180px_auto]">
      <Field label="Art" htmlFor="capability-kind" className="min-w-0 gap-1.5">
        <Select value={kind} onValueChange={(value) => setKind(value as CapabilityKind)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skill">Fähigkeit</SelectItem>
            <SelectItem value="certification">Zertifizierung</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Name"
        htmlFor="capability-name"
        required
        error={definitionFieldErrors.name}
        className="min-w-0 gap-1.5"
      >
        <Input
          value={definitionName}
          onChange={(event) => setDefinitionName(event.target.value)}
          placeholder="z. B. Wärmepumpen-Inbetriebnahme"
          maxLength={160}
        />
      </Field>
      <Field
        label="Hinweis vorher (Tage)"
        htmlFor="capability-warning-days"
        error={definitionFieldErrors.warningDays}
        className="min-w-0 gap-1.5"
      >
        <QuantityStepper
          min={0}
          value={kind === 'skill' ? '0' : warningDays}
          onChange={setWarningDays}
          disabled={kind === 'skill'}
        />
      </Field>
      <Button
        className="self-end"
        disabled={pendingAction !== null}
        onClick={async () => {
          setDefinitionError(null);
          const expiryWarningDays = kind === 'certification' ? parseDecimalInput(warningDays) : 0;
          const nextFieldErrors = {
            name: definitionName.trim() ? undefined : 'Bitte gib einen Namen an.',
            warningDays:
              !Number.isInteger(expiryWarningDays) || expiryWarningDays < 0 || expiryWarningDays > 365
                ? 'Bitte gib eine ganze Zahl zwischen 0 und 365 Tagen ein.'
                : undefined,
          };
          setDefinitionFieldErrors(nextFieldErrors);
          if (nextFieldErrors.name || nextFieldErrors.warningDays) {
            document
              .getElementById(nextFieldErrors.name ? 'capability-name' : 'capability-warning-days')
              ?.focus();
            return;
          }
          setPendingAction('create-definition');
          try {
            const result = await createCapability({
              kind,
              name: definitionName,
              expiryWarningDays,
            });
            if (!result.success) {
              setDefinitionError(
                describeFailure(
                  result.error,
                  { duplicate_name: 'Dieser Begriff ist bereits vorhanden.' },
                  'Der Begriff konnte nicht angelegt werden.',
                ),
              );
              return;
            }
            setDefinitionName('');
            showBanner({
              variant: 'success',
              message: 'Der Begriff wurde angelegt.',
            });
            refresh();
          } catch {
            setDefinitionError('Der Begriff konnte nicht angelegt werden.');
          } finally {
            setPendingAction(null);
          }
        }}
      >
        <Plus className="size-4" />
        Anlegen
      </Button>
      <div className="md:col-span-4">
        <ErrorText>{definitionError}</ErrorText>
      </div>
    </Card>
  );
}

type QualificationManagementDefinitionListProps = QualificationManagementDefinitionFormProps & {
  activeCapabilities: QualificationWorkspace['capabilities'];
};

export function QualificationManagementDefinitionList({
  activeCapabilities,
  pendingAction,
  setPendingAction,
  refresh,
}: QualificationManagementDefinitionListProps) {
  const { showBanner } = useBanner();

  return (
    <div className="divide-y rounded-lg border">
      {activeCapabilities.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Noch keine Fähigkeiten oder Zertifizierungen angelegt.
        </p>
      ) : (
        activeCapabilities.map((capability) => (
          <div
            key={capability.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
            data-testid="capability-definition-row"
            data-capability-name={capability.name}
          >
            <div className="min-w-0">
              <p className="font-medium">{capability.name}</p>
              <p className="text-xs text-muted-foreground">
                {getCapabilityKindLabel(capability.kind)}
                {capability.kind === 'certification'
                  ? ' · Hinweis ' + capability.defaultExpiryWarningDays + ' Tage vorher'
                  : ''}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingAction !== null}
              onClick={async () => {
                setPendingAction(`retire:${capability.id}`);
                try {
                  const result = await retireCapabilityDefinition(capability.id);
                  if (!result.success) {
                    showBanner({
                      variant: 'error',
                      message: 'Der Begriff konnte nicht archiviert werden.',
                    });
                    return;
                  }
                  showBanner({
                    variant: 'success',
                    message: 'Der Begriff wurde archiviert.',
                  });
                  refresh();
                } catch {
                  showBanner({
                    variant: 'error',
                    message: 'Der Begriff konnte nicht archiviert werden.',
                  });
                } finally {
                  setPendingAction(null);
                }
              }}
            >
              Archivieren
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
