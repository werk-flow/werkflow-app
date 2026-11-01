'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useBanner } from '@/components/ui/banner';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import type { PersonnelOnboardingTemplateSummary } from '@/lib/personnel/lifecycle-rows';
import { publishPersonnelOnboardingTemplate } from '@/lib/personnel/onboarding-actions';
import type { PersonnelRequirementType } from '@/lib/personnel/lifecycle';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const REQUIREMENT_OPTIONS: Array<{ value: PersonnelRequirementType; label: string }> = [
  { value: 'document', label: 'Dokument' },
  { value: 'qualification', label: 'Qualifikation' },
  { value: 'employment_condition', label: 'Beschäftigungsbedingung' },
  { value: 'work_schedule', label: 'Arbeitszeitmodell' },
  { value: 'team', label: 'Team' },
  { value: 'access', label: 'Zugang' },
  { value: 'acknowledgement', label: 'Bestätigung' },
  { value: 'manual', label: 'Manueller Punkt' },
];

type TemplateFieldErrors = {
  name?: string | undefined;
  itemTitle?: string | undefined;
};

function templateFieldErrors(name: string, itemTitle: string): TemplateFieldErrors {
  return {
    name: name.trim() ? undefined : 'Bitte gib einen Namen an.',
    itemTitle: itemTitle.trim() ? undefined : 'Bitte gib den ersten Punkt an.',
  };
}

/** Form state and publish submit of the onboarding template dialog. */
function useOnboardingTemplateForm() {
  const { showBanner } = useBanner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [itemTitle, setItemTitle] = useState('');
  const [requirementType, setRequirementType] = useState<PersonnelRequirementType>('manual');
  const [required, setRequired] = useState(true);
  const [blocksAccess, setBlocksAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TemplateFieldErrors>({});
  const { run, isPending } = useServerAction(publishPersonnelOnboardingTemplate);

  async function submit(): Promise<void> {
    setError(null);
    const errors = templateFieldErrors(name, itemTitle);
    setFieldErrors(errors);
    const templateErrors = { 'template-name': errors.name, 'template-item-title': errors.itemTitle };
    if (focusFirstInvalidField(templateErrors)) return;
    try {
      const result = await run({
        templateId: null,
        expectedVersion: 0,
        name,
        description: null,
        items: [
          {
            requirementType,
            title: itemTitle,
            description: null,
            isRequired: required,
            blocksAccess,
            dueOffsetDays: null,
          },
        ],
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(
          result.error === 'invalid_input'
            ? 'Bitte gib einen Namen und einen ersten Punkt an.'
            : 'Die Vorlage konnte nicht veröffentlicht werden.',
        );
        return;
      }
      setOpen(false);
      setName('');
      setItemTitle('');
      showBanner({ variant: 'success', message: 'Onboardingvorlage wurde veröffentlicht.' });
    } catch {
      setError('Die Vorlage konnte nicht veröffentlicht werden.');
    }
  }

  function openDialog(): void {
    setError(null);
    setFieldErrors({});
    setOpen(true);
  }

  function changeRequirementType(value: string): void {
    const option = REQUIREMENT_OPTIONS.find((candidate) => candidate.value === value);
    if (option) setRequirementType(option.value);
  }

  return {
    open,
    setOpen,
    name,
    setName,
    itemTitle,
    setItemTitle,
    requirementType,
    changeRequirementType,
    required,
    setRequired,
    blocksAccess,
    setBlocksAccess,
    error,
    fieldErrors,
    isPending,
    submit,
    openDialog,
  };
}

function OnboardingTemplateList({ templates }: { templates: PersonnelOnboardingTemplateSummary[] | null }) {
  if (templates === null) {
    return <RegionLoadError>Die Onboardingvorlagen konnten nicht geladen werden.</RegionLoadError>;
  }
  if (templates.length === 0) {
    return <EmptyState size="compact" title="Noch keine Vorlage eingerichtet." />;
  }
  return (
    <ul className="divide-y rounded-md border">
      {templates.map((template) => (
        <li key={template.id} className="flex items-center justify-between gap-3 p-3">
          <div>
            <p className="text-sm font-medium">{template.name}</p>
            <p className="text-xs text-muted-foreground">
              Version {template.currentVersionNumber}
              {template.description ? ` · ${template.description}` : ''}
            </p>
          </div>
          <Badge variant="secondary">
            {template.state === 'published'
              ? 'Veröffentlicht'
              : template.state === 'draft'
                ? 'Entwurf'
                : 'Archiviert'}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function OnboardingTemplatesHeader({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="onboarding-template-settings-title" className="text-base font-semibold">
          Onboardingvorlagen
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wiederverwendbare Ausgangspunkte. Es gibt keine automatisch angelegte Standardvorlage.
        </p>
      </div>
      <Button size="sm" onClick={onAdd} disabled={!canAdd}>
        <Plus className="size-4" /> Vorlage
      </Button>
    </div>
  );
}

function OnboardingTemplateFields({ form }: { form: ReturnType<typeof useOnboardingTemplateForm> }) {
  const {
    name,
    setName,
    itemTitle,
    setItemTitle,
    requirementType,
    changeRequirementType,
    required,
    setRequired,
    blocksAccess,
    setBlocksAccess,
    fieldErrors,
  } = form;
  return (
    <>
      <Field label="Name" htmlFor="template-name" required error={fieldErrors.name}>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Art des ersten Punkts" htmlFor="template-requirement-type">
        <SearchableSelect
          options={REQUIREMENT_OPTIONS}
          value={requirementType}
          onChange={changeRequirementType}
          searchPlaceholder="Art suchen…"
        />
      </Field>
      <Field label="Erster Punkt" htmlFor="template-item-title" required error={fieldErrors.itemTitle}>
        <Input value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={required} onCheckedChange={(value) => setRequired(value === true)} />
        Erforderlich
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={blocksAccess} onCheckedChange={(value) => setBlocksAccess(value === true)} />
        Blockiert die Zugangsaktivierung
      </label>
    </>
  );
}

export function PersonnelOnboardingTemplateSettings({
  templates,
}: {
  templates: PersonnelOnboardingTemplateSummary[] | null;
}) {
  const form = useOnboardingTemplateForm();
  const { open, setOpen, error, isPending, submit, openDialog } = form;

  useRealtimeRouterRefresh({ tables: ['personnel_onboarding_templates'] });

  return (
    <section
      className="space-y-4 border-b px-4 py-5 sm:px-6"
      aria-labelledby="onboarding-template-settings-title"
    >
      <OnboardingTemplatesHeader canAdd={templates !== null} onAdd={openDialog} />
      <OnboardingTemplateList templates={templates} />

      <Dialog open={open} onOpenChange={setOpen} pending={isPending}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Onboardingvorlage veröffentlichen</DialogTitle>
            <DialogDescription>
              Die erste Version enthält einen klaren Punkt. Weitere Anforderungen werden im erzeugten Plan
              bearbeitet.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (isPending) return;
              void submit();
            }}
            noValidate
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <DialogBody className="space-y-4 py-1">
              <OnboardingTemplateFields form={form} />
              <ErrorText>{error}</ErrorText>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Abbrechen
              </Button>
              <Button pending={isPending} type="submit" disabled={isPending}>
                Veröffentlichen
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
