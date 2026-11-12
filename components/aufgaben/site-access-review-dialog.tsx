'use client';

import { useState, type ReactElement } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import type { AttentionTask } from '@/lib/attention/types';
import { acceptSiteAccessProposal, rejectSiteAccessProposal } from '@/lib/site-access-proposals/actions';
import { SITE_ACCESS_LIMITS } from '@/lib/site-access-proposals/types';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { formatGermanDate } from '@/lib/utils';

// Loaded on a manager's intent through components/shared/lazy-dialog.tsx, so
// no Aufgaben cold start carries the review or its actions.

type SiteAccessTask = Extract<AttentionTask, { sourceType: 'site_access_proposal' }>;

const NEW_CONTACT = 'neu';
/** A raw Select holds at most nine options: „Neuer Zugangskontakt“ and eight to correct. */
const MAX_CORRECTABLE_CONTACTS = 8;
const CONTACT_CHOICE_ID = 'site-access-contact-choice';
const REASON_ID = 'site-access-reason';

const DECISION_FAILURES = {
  proposal_already_decided: 'Dieser Hinweis wurde schon entschieden. Die Aufgaben werden neu geladen.',
  proposal_not_found: 'Diesen Hinweis gibt es nicht mehr.',
  contact_not_found: 'Der gewählte Zugangskontakt ist nicht mehr am Einsatzort. Wähle einen anderen.',
  client_not_found: 'Den Kunden dieses Einsatzorts gibt es nicht mehr.',
};

type Runner<Input> = {
  run: (input: Input) => Promise<ActionResult>;
  isPending: boolean;
};
type AcceptRunner = Runner<{ proposalId: string; contactId: string | null }>;
type RejectRunner = Runner<{ proposalId: string; reason: string }>;

function initialContactChoice(task: SiteAccessTask): string {
  if (task.accessContacts.length === 0) return NEW_CONTACT;
  // One Zugangskontakt is the one the worker corrects; with several the office chooses.
  return task.accessContacts.length === 1 ? (task.accessContacts[0]?.id ?? '') : '';
}

/** The review's state and its submit: accept with the chosen contact, or reject with a reason. */
function useSiteAccessDecision(
  task: SiteAccessTask,
  accept: AcceptRunner,
  reject: RejectRunner,
  onClose: () => void,
) {
  const { showBanner } = useBanner();
  const [mode, setMode] = useState<'review' | 'reject'>('review');
  const [contactChoice, setContactChoice] = useState(() => initialContactChoice(task));
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const hasContact = task.values.contactName !== '';
  const contactChoiceError =
    hasContact && contactChoice === '' ? 'Wähle, welchen Zugangskontakt der Hinweis ersetzt.' : undefined;
  const reasonError = reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;

  const decide = (outcome: ReturnType<AcceptRunner['run']>, message: string) => {
    setFailure(null);
    void (async () => {
      const result = await outcome;
      if (!result.success) {
        setFailure(
          describeFailure(
            result.error,
            DECISION_FAILURES,
            'Die Entscheidung konnte nicht gespeichert werden.',
          ),
        );
        return;
      }
      onClose();
      showBanner({ variant: 'success', message });
    })();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (mode === 'reject') {
      if (focusFirstInvalidField({ [REASON_ID]: reasonError })) return;
      decide(reject.run({ proposalId: task.sourceId, reason: reason.trim() }), 'Der Hinweis ist abgelehnt.');
      return;
    }
    if (focusFirstInvalidField({ [CONTACT_CHOICE_ID]: contactChoiceError })) return;
    const contactId = hasContact && contactChoice !== NEW_CONTACT ? contactChoice : null;
    decide(
      accept.run({ proposalId: task.sourceId, contactId }),
      'Der Zugang ist beim Einsatzort gespeichert.',
    );
  };

  const switchMode = (next: 'review' | 'reject') => {
    setAttempted(false);
    setFailure(null);
    setMode(next);
  };

  return {
    mode,
    switchMode,
    submit,
    failure,
    contactChoice,
    setContactChoice,
    contactChoiceError: attempted ? contactChoiceError : undefined,
    reason,
    setReason,
    reasonError: attempted ? reasonError : undefined,
  };
}

/** The office review of one proposal; it loads when a manager reaches for its task row. */
export function SiteAccessReviewDialog({
  open,
  onOpenChange,
  task,
  onDecided,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: SiteAccessTask;
  /** Reads the Aufgaben overview again after the decision. */
  onDecided: () => Promise<void>;
}): ReactElement {
  const accept = useServerAction(acceptSiteAccessProposal, { settle: onDecided });
  const reject = useServerAction(rejectSiteAccessProposal, { settle: onDecided });
  const decision = useSiteAccessDecision(task, accept, reject, () => onOpenChange(false));
  const pending = accept.isPending || reject.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <DialogContent>
        <form onSubmit={decision.submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Zugang zu {task.siteName} prüfen</DialogTitle>
            <DialogDescription>
              {task.proposerName} hat am {formatGermanDate(task.proposedAt)} beim Auftrag{' '}
              {task.jobNumber ? `${task.jobNumber} ` : ''}„{task.jobTitle}“ einen anderen Zugang gemeldet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1 text-sm wrap-anywhere">
            {task.siteAddress && <p className="text-muted-foreground">{task.siteAddress}</p>}
            <ProposedContact task={task} decision={decision} />
            <ProposedAccessNotes task={task} />
            {decision.mode === 'reject' && (
              <Field
                label="Begründung"
                htmlFor={REASON_ID}
                required
                description={`${task.proposerName} sieht die Begründung beim Auftrag. Der gemeldete Kontakt wird nicht gespeichert.`}
                error={decision.reasonError}
              >
                <Textarea
                  value={decision.reason}
                  onChange={(event) => decision.setReason(event.target.value)}
                  maxLength={SITE_ACCESS_LIMITS.reason}
                  rows={3}
                />
              </Field>
            )}
            <ErrorText>{decision.failure}</ErrorText>
          </DialogBody>
          <ReviewFooter
            mode={decision.mode}
            onSwitch={decision.switchMode}
            pending={pending}
            acceptPending={accept.isPending}
            rejectPending={reject.isPending}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The proposed Zugangskontakt and, while reviewing, which contact it becomes. */
function ProposedContact({
  task,
  decision,
}: {
  task: SiteAccessTask;
  decision: ReturnType<typeof useSiteAccessDecision>;
}): ReactElement | null {
  const { values } = task;
  if (values.contactName === '') return null;
  return (
    <section className="space-y-2" aria-labelledby="site-access-contact-heading">
      <h3 id="site-access-contact-heading" className="font-medium">
        Zugangskontakt
      </h3>
      <p>
        {values.contactName}
        {values.contactPhone ? ` · ${values.contactPhone}` : ''}
      </p>
      {values.contactNote && <p className="text-muted-foreground">{values.contactNote}</p>}
      {decision.mode === 'review' && (
        <Field label="Speichern als" htmlFor={CONTACT_CHOICE_ID} error={decision.contactChoiceError}>
          <Select value={decision.contactChoice} onValueChange={decision.setContactChoice}>
            <SelectTrigger>
              <SelectValue placeholder="Bitte wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_CONTACT}>Neuer Zugangskontakt</SelectItem>
              {task.accessContacts.slice(0, MAX_CORRECTABLE_CONTACTS).map((contact) => (
                <SelectItem key={contact.id} value={contact.id}>
                  Ersetzt {contact.name}
                  {contact.phone ? ` (${contact.phone})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {decision.mode === 'review' && task.accessContacts.length > MAX_CORRECTABLE_CONTACTS && (
        <p className="text-muted-foreground">
          Hier stehen die ersten {MAX_CORRECTABLE_CONTACTS} Zugangskontakte. Einen anderen korrigierst du beim
          Kunden.
        </p>
      )}
    </section>
  );
}

/** The proposed access notes beside the Einsatzort's current ones. */
function ProposedAccessNotes({ task }: { task: SiteAccessTask }): ReactElement | null {
  if (task.values.accessNotes === '') return null;
  return (
    <section className="space-y-1" aria-labelledby="site-access-notes-heading">
      <h3 id="site-access-notes-heading" className="font-medium">
        Zugangshinweis
      </h3>
      <p className="text-muted-foreground">
        {task.currentAccessNotes ? `Bisher: ${task.currentAccessNotes}` : 'Bisher ohne Zugangshinweis.'}
      </p>
      <p className="whitespace-pre-wrap">Neu: {task.values.accessNotes}</p>
    </section>
  );
}

function ReviewFooter({
  mode,
  onSwitch,
  pending,
  acceptPending,
  rejectPending,
}: {
  mode: 'review' | 'reject';
  onSwitch: (next: 'review' | 'reject') => void;
  pending: boolean;
  acceptPending: boolean;
  rejectPending: boolean;
}): ReactElement {
  const submitPending = mode === 'review' ? acceptPending : rejectPending;
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => onSwitch(mode === 'review' ? 'reject' : 'review')}
      >
        {mode === 'review' ? 'Ablehnen' : 'Zurück'}
      </Button>
      <Button type="submit" pending={submitPending} disabled={pending}>
        {mode === 'review' ? 'Übernehmen' : 'Ablehnen'}
      </Button>
    </DialogFooter>
  );
}
