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
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATE_LABELS,
  EQUIPMENT_SUBTYPE_LABELS,
  EQUIPMENT_SUBTYPES_BY_CATEGORY,
  type EquipmentCategory,
  type EquipmentDetail,
  type EquipmentState,
  type EquipmentSubtype,
} from '@/lib/installed-equipment/types';
import {
  EquipmentAssignmentFields,
  EquipmentTechnicalFields,
  EquipmentWarrantyFields,
} from './equipment-form-sections';
import type { EquipmentFormMode } from './equipment-form-state';
import {
  useEquipmentForm,
  type EquipmentCreateSubmission,
  type EquipmentFormController,
} from './use-equipment-form';

export type { EquipmentCreateSubmission, EquipmentPendingDraft } from './use-equipment-form';

type EquipmentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EquipmentFormMode;
  initial?: EquipmentDetail | null;
  /**
   * Create from a list (feedback canon): the dialog closes at once and the
   * caller renders the pending row until `result` settles. Without it a
   * create navigates to the new record.
   */
  onSubmitted?: (submission: EquipmentCreateSubmission) => void;
  /** Edit settled by the caller (a live-view refresh) instead of a route refresh. */
  onSaved?: () => void;
};

// Stays in this file: the subtype Select is registered here as a bounded
// runtime choice (lib/ui/select-registry.test.ts).
function EquipmentClassificationFields({
  controller,
  mode,
}: {
  controller: EquipmentFormController;
  mode: EquipmentFormMode;
}): ReactElement {
  const { form, setForm, updateField, fieldErrors, clientOption, parentOptions } = controller;
  const subtypeOptions = EQUIPMENT_SUBTYPES_BY_CATEGORY[form.category];
  // A successor takes the predecessor's parent (replace_installed_equipment), so a
  // replacement keeps the predecessor's component-or-not category class.
  const categoryOptions =
    mode === 'replace'
      ? EQUIPMENT_CATEGORIES.filter(
          (category) => (category === 'system_component') === Boolean(form.parentEquipmentId),
        )
      : EQUIPMENT_CATEGORIES;
  return (
    <>
      <Field label="Kategorie" htmlFor="equipment-category">
        <Select
          value={form.category}
          onValueChange={(value: EquipmentCategory) =>
            setForm((current) => ({
              ...current,
              category: value,
              subtype: null,
              ...(value === 'system_component' ? {} : { parentEquipmentId: null }),
            }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((category) => (
              <SelectItem key={category} value={category}>
                {EQUIPMENT_CATEGORY_LABELS[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Untertyp" htmlFor="equipment-subtype">
        <Select
          value={form.subtype ?? 'none'}
          onValueChange={(value) =>
            updateField('subtype', value === 'none' ? null : (value as EquipmentSubtype))
          }
          disabled={subtypeOptions.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Nicht angegeben" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nicht angegeben</SelectItem>
            {subtypeOptions.map((subtype) => (
              <SelectItem key={subtype} value={subtype}>
                {EQUIPMENT_SUBTYPE_LABELS[subtype]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {form.category === 'system_component' && (
        <Field
          label="Übergeordnete Anlage"
          htmlFor="equipment-parent"
          required
          error={fieldErrors.parentEquipmentId}
          className="sm:col-span-2"
        >
          <SearchableSelect
            value={form.parentEquipmentId ?? ''}
            disabled={mode === 'replace'}
            onChange={(value) => updateField('parentEquipmentId', value || null)}
            options={parentOptions}
            loading={clientOption.loading}
            placeholder="Anlage auswählen"
            searchPlaceholder="Anlage suchen…"
          />
        </Field>
      )}
      {mode !== 'edit' && (
        <Field label="Aktueller Zustand" htmlFor="equipment-state">
          <Select value={form.state} onValueChange={(value: EquipmentState) => updateField('state', value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['unknown', 'active', 'inactive'] as const).map((state) => (
                <SelectItem key={state} value={state}>
                  {EQUIPMENT_STATE_LABELS[state]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Position am Einsatzort" htmlFor="equipment-location">
        <Input
          value={form.locationDetail ?? ''}
          onChange={(event) => updateField('locationDetail', event.target.value)}
          placeholder="z. B. Heizraum, Keller"
        />
      </Field>
    </>
  );
}

export function EquipmentFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmitted,
  onSaved,
}: EquipmentFormDialogProps): ReactElement {
  const controller = useEquipmentForm({
    onOpenChange,
    mode,
    initial,
    onSubmitted,
    onSaved,
  });
  const { form, updateField, fieldErrors, isPending, handleSubmit } = controller;
  const title =
    mode === 'create' ? 'Anlage erfassen' : mode === 'edit' ? 'Anlagendaten bearbeiten' : 'Anlage ersetzen';

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'replace'
              ? 'Die bisherige Anlage und ihre Historie bleiben erhalten. Die neue Anlage erhält eine eigene Nummer.'
              : 'Ordne die Anlage einem vorhandenen Kunden und Einsatzort zu.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) void handleSubmit();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="grid gap-4 py-1 sm:grid-cols-2">
              <EquipmentAssignmentFields controller={controller} mode={mode} />
              <EquipmentClassificationFields controller={controller} mode={mode} />
            </div>

            <EquipmentTechnicalFields form={form} updateField={updateField} mode={mode} />

            <EquipmentWarrantyFields form={form} updateField={updateField} />

            {mode !== 'create' && (
              <Field
                label="Grund der Änderung"
                htmlFor="equipment-reason"
                required
                error={fieldErrors.reason}
              >
                <Textarea
                  value={form.reason ?? ''}
                  onChange={(event) => updateField('reason', event.target.value)}
                  placeholder="Warum wird diese Änderung vorgenommen?"
                />
              </Field>
            )}
            <ErrorText>{controller.error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              {mode === 'replace' ? 'Nachfolger anlegen' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
