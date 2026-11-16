'use client';

import { useState, type ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import {
  REPLACEMENT_TOO_MANY_PLANS_MESSAGE,
  replacementErrorMessage,
} from '@/lib/installed-equipment/replacement-messages';
import type {
  EquipmentCarryOverInput,
  EquipmentDetail,
  EquipmentListItem,
  EquipmentReplacementPlan,
} from '@/lib/installed-equipment/types';
import { formatLocalCalendarDay, parseIsoLocalDate } from '@/lib/utils';
import { EquipmentFormDialog } from './equipment-form-dialog';

const REASON_MESSAGE = 'Bitte begründe, warum der Wartungsplan beim Vorgänger bleibt.';

/** The control id of a plan's „bleibt beim Vorgänger“ reason. */
function reasonFieldId(planId: string): string {
  return `equipment-carry-reason-${planId}`;
}

/**
 * A component the replacement asks about. Mirrors the component rule of
 * replace_installed_equipment, which refuses a choice set that differs.
 */
function isCarriedComponent(component: EquipmentListItem): boolean {
  return (
    !component.voidedAt &&
    !component.archivedAt &&
    component.state !== 'replaced' &&
    component.state !== 'decommissioned'
  );
}

export type EquipmentCarryOverController = {
  plans: EquipmentReplacementPlan[];
  /** More running plans than one replacement carries; the server refuses the replacement. */
  plansOverflow: boolean;
  components: EquipmentListItem[];
  carried: ReadonlyMap<string, boolean>;
  reasons: ReadonlyMap<string, string>;
  setCarried: (id: string, carry: boolean) => void;
  setReason: (planId: string, reason: string) => void;
  /** The choice per plan and component, as replace_installed_equipment takes it. */
  input: EquipmentCarryOverInput;
  /** Missing reasons keyed by control id, in visual order. */
  errors: Record<string, string | undefined>;
  /** The message of a refusal only a replacement raises; undefined for any other code. */
  errorMessage: (error: string | undefined) => string | undefined;
};

/** The replace dialog's choice per running plan and component; everything is carried over by default. */
function useEquipmentCarryOver(initial: EquipmentDetail | null | undefined): EquipmentCarryOverController {
  // The plans and components as the dialog opened: a live refresh while it
  // stays open never puts a version the manager did not review into the
  // choices; the server refuses the outdated set instead.
  const [plans] = useState(() => initial?.replacementPlans ?? []);
  const [plansOverflow] = useState(() => initial?.replacementPlansOverflow ?? false);
  const [components] = useState(() => (initial?.components ?? []).filter(isCarriedComponent));
  const [carried, setCarriedMap] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [reasons, setReasons] = useState<ReadonlyMap<string, string>>(new Map());
  const isCarried = (id: string) => carried.get(id) ?? true;
  return {
    plans,
    plansOverflow,
    components,
    carried,
    reasons,
    setCarried: (id, carry) => setCarriedMap((current) => new Map(current).set(id, carry)),
    setReason: (planId, reason) => setReasons((current) => new Map(current).set(planId, reason)),
    input: {
      plans: plans.map((plan) => ({
        planId: plan.id,
        expectedVersion: plan.version,
        carry: isCarried(plan.id),
        reason: isCarried(plan.id) ? null : (reasons.get(plan.id) ?? '').trim(),
      })),
      components: components.map((component) => ({
        equipmentId: component.id,
        carry: isCarried(component.id),
      })),
    },
    errorMessage: replacementErrorMessage,
    errors: Object.fromEntries(
      plans.map((plan) => [
        reasonFieldId(plan.id),
        !isCarried(plan.id) && (reasons.get(plan.id) ?? '').trim().length < 3 ? REASON_MESSAGE : undefined,
      ]),
    ),
  };
}

/** „Übernehmen“, named for screen readers with the plan or component it carries (`subjectId`). */
function CarryCheckbox({
  id,
  subjectId,
  checked,
  onChange,
}: {
  id: string;
  subjectId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Checkbox
        id={id}
        aria-labelledby={`${id}-label ${subjectId}`}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label id={`${id}-label`} htmlFor={id} className="text-sm font-normal">
        Übernehmen
      </Label>
    </span>
  );
}

function NextDue({ value }: { value: string }): ReactElement {
  const date = parseIsoLocalDate(value);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      Nächste Fälligkeit {date ? formatLocalCalendarDay(date, 'date') : value}
      {value < getBusinessTodayIso() && <Badge variant="warning">überfällig</Badge>}
    </span>
  );
}

/** One running plan with its carry-over choice and, when it stays, its reason. */
function CarryPlanRow({
  plan,
  carry,
  reason,
  error,
  onCarry,
  onReason,
}: {
  plan: EquipmentReplacementPlan;
  carry: boolean;
  reason: string;
  error: string | undefined;
  onCarry: (checked: boolean) => void;
  onReason: (value: string) => void;
}): ReactElement {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 text-sm">
          <p id={`equipment-carry-plan-${plan.id}-subject`} className="font-medium">
            Wartungsplan {plan.planNumber} · {plan.templateName}
          </p>
          {plan.nextDueDate && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <NextDue value={plan.nextDueDate} />
            </div>
          )}
        </div>
        <CarryCheckbox
          id={`equipment-carry-plan-${plan.id}`}
          subjectId={`equipment-carry-plan-${plan.id}-subject`}
          checked={carry}
          onChange={onCarry}
        />
      </div>
      {!carry && (
        <Field
          label="Warum bleibt der Plan beim Vorgänger?"
          htmlFor={reasonFieldId(plan.id)}
          required
          error={error}
        >
          <Textarea
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            placeholder="z. B. Die neue Anlage braucht keine Abgasmessung."
          />
        </Field>
      )}
    </div>
  );
}

/** The plans and components of the replaced Anlage, each with its carry-over choice. */
function EquipmentCarryOverSection({
  controller,
  showErrors,
}: {
  controller: EquipmentCarryOverController;
  showErrors: boolean;
}): ReactElement | null {
  const { plans, plansOverflow, components, carried, reasons, setCarried, setReason, errors } = controller;
  if (plans.length === 0 && components.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="equipment-carry-over-title">
      <div>
        <h3 id="equipment-carry-over-title" className="text-sm font-semibold">
          Was geht auf den Nachfolger über?
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Offene Fälligkeiten wandern mit ihrem Datum mit. Erledigte Wartungen bleiben beim Vorgänger.
        </p>
      </div>
      {plansOverflow && (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          {REPLACEMENT_TOO_MANY_PLANS_MESSAGE}
        </p>
      )}
      {plans.map((plan) => (
        <CarryPlanRow
          key={plan.id}
          plan={plan}
          carry={carried.get(plan.id) ?? true}
          reason={reasons.get(plan.id) ?? ''}
          error={showErrors ? errors[reasonFieldId(plan.id)] : undefined}
          onCarry={(checked) => setCarried(plan.id, checked)}
          onReason={(value) => setReason(plan.id, value)}
        />
      ))}
      {components.map((component) => (
        <div
          key={component.id}
          className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p id={`equipment-carry-component-${component.id}-subject`} className="min-w-0 text-sm">
            <span className="font-medium">Komponente {component.name}</span>
            <span className="block text-xs text-muted-foreground">{component.equipmentNumber}</span>
          </p>
          <CarryCheckbox
            id={`equipment-carry-component-${component.id}`}
            subjectId={`equipment-carry-component-${component.id}-subject`}
            checked={carried.get(component.id) ?? true}
            onChange={(checked) => setCarried(component.id, checked)}
          />
        </div>
      ))}
    </section>
  );
}

/**
 * „Anlage ersetzen“: the equipment form in replace mode with the carry-over
 * choice. It mounts when the dialog opens, so the choice starts from the plans
 * and components shown at that moment.
 */
export function EquipmentReplaceDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: EquipmentDetail;
}): ReactElement {
  const controller = useEquipmentCarryOver(initial);
  return (
    <EquipmentFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="replace"
      initial={initial}
      carryOver={{
        controller,
        render: (showErrors) => <EquipmentCarryOverSection controller={controller} showErrors={showErrors} />,
      }}
    />
  );
}
