'use client';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';

import { useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DateTimeField } from '@/components/ui/date-time-field';
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
import { useServerAction } from '@/hooks/use-server-action';
import { createCustomerFollowUp } from '@/lib/customer-relationships/actions';
import { parseBerlinDateTimeInput, tomorrowMorningInBerlin } from '@/lib/customer-relationships/date-time';
import { linkServiceCaseRelation } from '@/lib/service-cases/actions';
import {
  SERVICE_CASE_RELATION_LABELS,
  SERVICE_CASE_RELATION_TYPES,
  type ServiceCaseDetailWorkspace,
  type ServiceCaseEvidenceOption,
  type ServiceCaseRelationType,
} from '@/lib/service-cases/types';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';

const RELATION_ERRORS: Record<string, string> = {
  service_case_stale_version:
    'Der Servicefall wurde inzwischen geändert. Prüfe den aktuellen Stand und versuche es erneut.',
  service_case_relation_cycle: 'Diese Verknüpfung würde einen widersprüchlichen Kreis erzeugen.',
};

export function RelationDialog({
  workspace,
  open,
  onOpenChange,
  onSaved,
}: {
  workspace: ServiceCaseDetailWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after success so the section settles through the live read. */
  onSaved: () => void;
}): ReactElement {
  const [relatedId, setRelatedId] = useState('');
  const [relationType, setRelationType] = useState<ServiceCaseRelationType>('related');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(async () => {
    const result = await linkServiceCaseRelation({
      serviceCaseId: workspace.serviceCase.id,
      relatedServiceCaseId: relatedId,
      relationType,
      expectedVersion: workspace.serviceCase.version,
      reason,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      setError(
        describeFailure(result.error, RELATION_ERRORS, 'Der Zusammenhang konnte nicht verknüpft werden.'),
      );
      return;
    }
    onOpenChange(false);
    onSaved();
  });
  const [attempted, setAttempted] = useState(false);
  const fieldErrors = {
    'relation-case': relatedId ? undefined : 'Bitte wähle einen Servicefall.',
    'relation-reason': reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined,
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Servicefälle verknüpfen</DialogTitle>
          <DialogDescription>
            Beide Fälle bleiben eigenständig und vollständig nachvollziehbar.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isPending) return;
            setAttempted(true);
            if (focusFirstInvalidField(fieldErrors)) return;
            void run();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4 py-2">
              <Field
                label="Servicefall"
                htmlFor="relation-case"
                required
                error={attempted ? fieldErrors['relation-case'] : undefined}
              >
                <SearchableSelect
                  value={relatedId}
                  onChange={setRelatedId}
                  options={workspace.relatedCases.map((item) => ({
                    value: item.id,
                    label: `${item.caseNumber} · ${item.summary}`,
                  }))}
                  placeholder="Servicefall suchen"
                />
              </Field>
              <Field label="Beziehung" htmlFor="relation-type">
                <Select
                  value={relationType}
                  onValueChange={(value) => setRelationType(value as ServiceCaseRelationType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_CASE_RELATION_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {SERVICE_CASE_RELATION_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Begründung"
                htmlFor="relation-reason"
                required
                error={attempted ? fieldErrors['relation-reason'] : undefined}
              >
                <Input value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
            </div>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}Verknüpfen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Picks the exact evidence version. The owner (`ServiceCaseEvidenceLink`)
 * runs the write: the dialog stays open and pending until the server answers,
 * and a refusal shows here, beside the submit.
 */
export function EvidenceDialog({
  options,
  open,
  onOpenChange,
  isPending,
  error,
  onLink,
}: {
  options: ServiceCaseEvidenceOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  error: string | null;
  onLink: (option: ServiceCaseEvidenceOption) => void;
}): ReactElement {
  const [revisionId, setRevisionId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const revisionError = revisionId ? undefined : 'Bitte wähle einen Arbeitsnachweis.';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arbeitsnachweis verknüpfen</DialogTitle>
          <DialogDescription>
            Verknüpft wird genau diese Version aus dem zugeordneten Auftrag. Der Nachweis wird nicht kopiert.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isPending) return;
            setAttempted(true);
            const option = options.find((entry) => entry.revisionId === revisionId);
            if (focusFirstInvalidField({ 'evidence-revision': revisionError }) || !option) return;
            onLink(option);
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <Field
              label="Nachweisversion"
              htmlFor="evidence-revision"
              required
              error={attempted ? revisionError : undefined}
              className="py-2"
            >
              <SearchableSelect
                value={revisionId}
                onChange={setRevisionId}
                options={options.map((option) => ({
                  value: option.revisionId,
                  label: `${option.title} · ${WORK_ARTIFACT_KIND_LABELS[option.kind]} · Version ${option.revisionNumber}`,
                }))}
                placeholder="Arbeitsnachweis suchen"
                emptyMessage="Keine unverknüpfte Version gefunden"
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}Verknüpfen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FollowUpDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: ServiceCaseDetailWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const currentOwner = workspace.followUpOwners.find((owner) => owner.userId === workspace.currentActorId);
  const [title, setTitle] = useState(`Servicefall ${workspace.serviceCase.caseNumber} nachfassen`);
  const [note, setNote] = useState('');
  const [ownerUserId, setOwnerUserId] = useState(currentOwner?.userId ?? '');
  const [dueAt, setDueAt] = useState(() => tomorrowMorningInBerlin());
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(async () => {
    const dueDate = parseBerlinDateTimeInput(dueAt);
    if (!dueDate) return;
    const result = await createCustomerFollowUp(workspace.serviceCase.clientId, {
      title,
      note,
      ownerUserId,
      dueAt: dueDate.toISOString(),
      sourceType: 'service_case',
      sourceId: workspace.serviceCase.id,
    });
    if (!result.success) {
      setError('Die Nachfassaktion konnte nicht angelegt werden.');
      return;
    }
    onOpenChange(false);
    // The follow-up lives under Aufgaben, not on this page: the banner is the
    // only confirmation the user gets here.
    showBanner({ variant: 'success', message: 'Nachfassaktion wurde angelegt.' });
  });
  const titleError = attempted && !title.trim() ? 'Bitte gib einen Titel ein.' : undefined;
  const ownerError = attempted && !ownerUserId ? 'Bitte wähle eine zuständige Person.' : undefined;
  const dueError =
    attempted && !parseBerlinDateTimeInput(dueAt) ? 'Bitte gib eine Fälligkeit an.' : undefined;
  function submit(): void {
    setError(null);
    setAttempted(true);
    const firstInvalidId = !title.trim()
      ? 'service-follow-up-title'
      : !ownerUserId
        ? 'service-follow-up-owner'
        : !parseBerlinDateTimeInput(dueAt)
          ? 'service-follow-up-due-date'
          : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    void run();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nachfassaktion anlegen</DialogTitle>
          <DialogDescription>
            Lege einen klaren nächsten Schritt für diesen Servicefall fest. Die Aktion erscheint in der
            bestehenden Aufgabenübersicht.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <p className="rounded-md bg-muted px-3 py-2 text-sm">Quelle: {workspace.serviceCase.caseNumber}</p>
          <Field label="Titel" htmlFor="service-follow-up-title" required error={titleError}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Zuständig" htmlFor="service-follow-up-owner" required error={ownerError}>
            <SearchableSelect
              value={ownerUserId}
              onChange={setOwnerUserId}
              options={workspace.followUpOwners.map((owner) => ({ value: owner.userId, label: owner.name }))}
              placeholder="Person wählen"
              searchPlaceholder="Person suchen…"
              emptyMessage="Keine Person gefunden"
            />
          </Field>
          <Field label="Fällig am" htmlFor="service-follow-up-due-date" required error={dueError}>
            <DateTimeField
              idPrefix="service-follow-up-due"
              value={dueAt}
              onChange={setDueAt}
              dateAriaLabel="Fälligkeitsdatum"
              invalid={Boolean(dueError)}
            />
          </Field>
          <Field label="Notiz" htmlFor="service-follow-up-note">
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
