'use client';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import type { MaintenancePlanItem, MaintenanceTemplateOption } from '@/lib/maintenance/types';
import {
  MaintenancePlanEquipmentFieldset,
  MaintenancePlanNotesFields,
  MaintenancePlanScheduleFields,
  MaintenancePlanScopeFields,
} from './maintenance-plan-form-sections';
import { useMaintenancePlanForm, type MaintenancePlanCreateSubmission } from './use-maintenance-plan-form';

export type {
  MaintenancePlanCreateSubmission,
  MaintenancePlanPendingDraft,
} from './use-maintenance-plan-form';

export function MaintenancePlanDialog({
  open,
  onOpenChange,
  templates,
  initial,
  onSubmitted,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: MaintenanceTemplateOption[];
  initial?: MaintenancePlanItem;
  /**
   * Create from the workspace (feedback canon): the dialog closes at once and
   * the caller renders the pending card until `result` settles.
   */
  onSubmitted?: (submission: MaintenancePlanCreateSubmission) => void;
  /** Revision settled by the caller (a live-view refresh) instead of a route refresh. */
  onSaved?: () => void;
}): ReactElement {
  const controller = useMaintenancePlanForm({
    onOpenChange,
    templates,
    initial,
    onSubmitted,
    onSaved,
  });
  const { form, setForm, fieldErrors, isPending, submit } = controller;
  const isRevision = Boolean(initial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Wartungsplan überarbeiten' : 'Wartungsplan anlegen'}</DialogTitle>
          <DialogDescription>
            Der Plan gilt für genau einen Kunden und Einsatzort. Spätere Änderungen erzeugen eine neue
            Revision und verändern frühere Fälligkeiten nicht rückwirkend.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) submit();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <MaintenancePlanScopeFields controller={controller} templates={templates} initial={initial} />
              <MaintenancePlanScheduleFields form={form} setForm={setForm} fieldErrors={fieldErrors} />
              <MaintenancePlanEquipmentFieldset
                site={controller.site}
                clientOption={controller.clientOption}
                form={form}
                setForm={setForm}
                fieldErrors={fieldErrors}
              />
              <MaintenancePlanNotesFields
                form={form}
                setForm={setForm}
                fieldErrors={fieldErrors}
                isRevision={isRevision}
              />
            </div>
            <ErrorText>{controller.error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              {initial ? 'Neue Revision speichern' : 'Wartungsplan anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
