'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
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
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { PersonnelRequirementType } from '@/lib/personnel/lifecycle';

import { REQUIREMENT_TYPES } from './personnel-lifecycle-options';
import type {
  PersonnelLifecyclePlan,
  PersonnelLifecycleRequirements,
} from './use-personnel-lifecycle-onboarding';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

type PersonnelLifecyclePlanDialogProps = {
  lifecycle: PersonnelLifecycleController;
  plan: PersonnelLifecyclePlan;
};

export function PersonnelLifecyclePlanDialog({ lifecycle, plan }: PersonnelLifecyclePlanDialogProps) {
  const { data, isPending, mutationDisabled, error, fieldErrors } = lifecycle;
  const {
    planOpen,
    setPlanOpen,
    planName,
    setPlanName,
    planTemplateVersionId,
    setPlanTemplateVersionId,
    planStartDate,
    setPlanStartDate,
    submitPlan,
  } = plan;

  return (
    <Dialog open={planOpen} onOpenChange={setPlanOpen} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Onboardingplan anlegen</DialogTitle>
          <DialogDescription>
            Du kannst leer beginnen oder eine veröffentlichte Vorlage als bearbeitbare Kopie verwenden.
            Bestandsdaten gelten nie automatisch als erledigt.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) void submitPlan();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody className="space-y-4 py-1">
            <Field label="Bezeichnung" htmlFor="plan-name" required error={fieldErrors['plan-name']}>
              <Input value={planName} onChange={(event) => setPlanName(event.target.value)} />
            </Field>
            <Field label="Vorlage" htmlFor="onboarding-plan-template">
              <SearchableSelect
                options={[
                  { value: '', label: 'Ohne Vorlage' },
                  ...data.templates.map((template) => ({
                    value: template.currentVersionId,
                    label: `${template.name} · Version ${template.currentVersionNumber}`,
                  })),
                ]}
                value={planTemplateVersionId}
                onChange={setPlanTemplateVersionId}
                searchPlaceholder="Vorlage suchen…"
              />
            </Field>
            <Field label="Zieldatum" htmlFor="onboarding-plan-target-date">
              <DatePicker
                value={planStartDate}
                onChange={setPlanStartDate}
                disabled={isPending}
                ariaLabel="Zieldatum"
              />
            </Field>
            {data.templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Keine veröffentlichte Vorlage. Der Plan startet leer.
              </p>
            ) : null}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPlanOpen(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={mutationDisabled}>
              Plan anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PersonnelLifecycleRequirementDialogProps = {
  lifecycle: PersonnelLifecycleController;
  requirements: PersonnelLifecycleRequirements;
};

export function PersonnelLifecycleRequirementDialog({
  lifecycle,
  requirements,
}: PersonnelLifecycleRequirementDialogProps) {
  const { isPending, mutationDisabled, error, fieldErrors } = lifecycle;
  const {
    requirementOpen,
    setRequirementOpen,
    requirementTitle,
    setRequirementTitle,
    requirementType,
    setRequirementType,
    requirementRequired,
    setRequirementRequired,
    requirementBlocksAccess,
    setRequirementBlocksAccess,
    submitRequirement,
  } = requirements;

  return (
    <Dialog open={requirementOpen} onOpenChange={setRequirementOpen} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anforderung ergänzen</DialogTitle>
          <DialogDescription>
            Die Anforderung verweist später auf vorhandene Nachweise. Sie kopiert keine Fachdaten.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) void submitRequirement();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody className="space-y-4 py-1">
            <Field label="Art" htmlFor="onboarding-requirement-type">
              <SearchableSelect
                options={REQUIREMENT_TYPES}
                value={requirementType}
                onChange={(value) => setRequirementType(value as PersonnelRequirementType)}
                searchPlaceholder="Art suchen…"
              />
            </Field>
            <Field
              label="Titel"
              htmlFor="requirement-title"
              required
              error={fieldErrors['requirement-title']}
            >
              <Input value={requirementTitle} onChange={(event) => setRequirementTitle(event.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={requirementRequired}
                onCheckedChange={(value) => setRequirementRequired(value === true)}
              />
              Erforderlich
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={requirementBlocksAccess}
                onCheckedChange={(value) => setRequirementBlocksAccess(value === true)}
              />
              Blockiert die Zugangsaktivierung
            </label>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRequirementOpen(false)}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={mutationDisabled}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
