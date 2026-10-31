'use client';

import { describeFailure } from '@/lib/action-messages';
import { useRef, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { setMaintenancePlanArchived, transitionMaintenancePlan } from '@/lib/maintenance/actions';
import type { MaintenancePlanItem, MaintenancePlanStatus } from '@/lib/maintenance/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const PLAN_ACTION_ERROR_MESSAGES: Record<string, string> = {
  maintenance_stale_version: 'Der Wartungsplan wurde inzwischen geändert. Bitte lade die Seite neu.',
  maintenance_reason_required: 'Gib eine kurze Begründung ein.',
  maintenance_plan_archive_requires_terminated:
    'Der Wartungsplan muss zuerst beendet werden, bevor du ihn archivieren kannst.',
  maintenance_plan_transition_not_allowed: 'Dieser Statuswechsel ist im aktuellen Zustand nicht möglich.',
};

type PlanTargetStatus = Exclude<MaintenancePlanStatus, 'draft'>;

function planActionTitle(toStatus: PlanTargetStatus | undefined, archived: boolean | undefined): string {
  return toStatus === 'active'
    ? 'Wartungsplan aktivieren'
    : toStatus === 'suspended'
      ? 'Wartungsplan pausieren'
      : toStatus === 'terminated'
        ? 'Wartungsplan beenden'
        : archived
          ? 'Wartungsplan archivieren'
          : 'Wartungsplan wiederherstellen';
}

export function MaintenancePlanActionDialog({
  open,
  onOpenChange,
  plan,
  toStatus,
  archived,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: MaintenancePlanItem;
  toStatus?: PlanTargetStatus;
  archived?: boolean;
  /** Settled by the caller (a live-view refresh); without it the action's response renders the route. */
  onSaved?: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    const nextReasonError = reason.trim().length < 3 ? 'Gib eine kurze Begründung ein.' : undefined;
    setReasonError(nextReasonError ?? null);
    if (focusFirstInvalidField({ 'maintenance-action-reason': nextReasonError })) return;
    const input = {
      planId: plan.id,
      expectedVersion: plan.version,
      reason,
      idempotencyKey: idempotencyKey.current,
    };
    const result = toStatus
      ? await transitionMaintenancePlan({ ...input, toStatus })
      : await setMaintenancePlanArchived({ ...input, archived: archived ?? true });
    if (!result.success) {
      setError(
        describeFailure(result.error, PLAN_ACTION_ERROR_MESSAGES, 'Der Status konnte nicht geändert werden.'),
      );
      return;
    }
    onOpenChange(false);
    onSaved?.();
  });
  const title = planActionTitle(toStatus, archived);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {plan.planNumber}. Bestehende Fälligkeiten und Revisionen bleiben als Verlauf erhalten.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Begründung"
          htmlFor="maintenance-action-reason"
          required
          error={reasonError}
          className="py-2"
        >
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Abbrechen
          </Button>
          <Button
            pending={isPending}
            type="button"
            variant={toStatus === 'terminated' ? 'destructive' : 'default'}
            onClick={() => void run()}
            disabled={isPending}
          >
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
