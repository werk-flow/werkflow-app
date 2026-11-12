'use client';

import { useRouter } from 'next/navigation';
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
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import { acceptSiteAccessProposal, rejectSiteAccessProposal } from '@/lib/site-access-proposals/actions';
import {
  SITE_ACCESS_LIMITS,
  type SiteAccessReview,
  type SiteAccessReviewRead,
} from '@/lib/site-access-proposals/types';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { formatGermanDate } from '@/lib/utils';

// Part of the customer page only (components/kunden/site-access-review.tsx):
// no other page's cold start carries the review or its actions.

const NEW_CONTACT = 'neu';
const CONTACT_CHOICE_ID = 'site-access-contact-choice';

function contactOptions(review: SiteAccessReview): SearchableSelectOption[] {
  return [
    { value: NEW_CONTACT, label: 'Neuer Zugangskontakt' },
    ...review.accessContacts.map((contact) => ({
      value: contact.id,
      label: `Ersetzt ${contact.name}`,
      description: contact.phone ?? undefined,
    })),
  ];
}
const REASON_ID = 'site-access-reason';

const DECISION_FALLBACK =
  'Die Entscheidung konnte nicht gespeichert werden. Versuche es in einem Moment erneut.';

const DECISION_FAILURES = {
  proposal_already_decided: 'Dieser Hinweis wurde schon entschieden.',
  proposal_changed:
    'Der Hinweis wurde gerade geändert. Hier steht jetzt die neue Fassung; prüfe sie und entscheide erneut.',
  site_changed:
    'Der Einsatzort wurde inzwischen geändert. Hier stehen jetzt die aktuellen Angaben; prüfe sie und entscheide erneut.',
  proposal_not_found: 'Diesen Hinweis gibt es nicht mehr.',
  contact_not_found: 'Der gewählte Zugangskontakt ist nicht mehr am Einsatzort. Wähle einen anderen.',
  client_not_found: 'Den Kunden dieses Einsatzorts gibt es nicht mehr.',
  // A lost answer included: a decision that did land refuses the retry as already decided.
  unexpected_error: DECISION_FALLBACK,
};

type Runner<Input> = {
  run: (input: Input) => Promise<ActionResult>;
  isPending: boolean;
};
type AcceptInput = {
  proposalId: string;
  revision: number;
  reviewedAccessNotes: string;
  contact: { id: string; reviewedName: string; reviewedPhone: string } | null;
};
type AcceptRunner = Runner<AcceptInput>;

/** A refused decision page reads the review again: a new revision, or the Einsatzort as it is now. */
const REREAD_ON = new Set(['proposal_changed', 'site_changed']);
type RejectRunner = Runner<{ proposalId: string; revision: number; reason: string }>;

function initialContactChoice(review: SiteAccessReview): string {
  if (review.accessContacts.length === 0) return NEW_CONTACT;
  // One Zugangskontakt is the one the worker corrects; with several the office chooses.
  return review.accessContacts.length === 1 ? (review.accessContacts[0]?.id ?? '') : '';
}

/**
 * The contact choice, the reason and the submit attempt, which belong to one
 * revision: a replacement starts them anew, while the review's failure notice
 * stays and says why the review changed.
 */
function useRevisionInput(review: SiteAccessReview) {
  const [choiceRevision, setChoiceRevision] = useState(review.revision);
  const [contactChoice, setContactChoice] = useState(() => initialContactChoice(review));
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  if (choiceRevision !== review.revision) {
    setChoiceRevision(review.revision);
    setContactChoice(initialContactChoice(review));
    setReason('');
    setAttempted(false);
  }
  return { contactChoice, setContactChoice, reason, setReason, attempted, setAttempted };
}

/**
 * The acceptance of the reviewed revision: the chosen Zugangskontakt, or
 * none for a new one, and what the review showed of what it overwrites.
 */
function acceptInput(review: SiteAccessReview, contactChoice: string): AcceptInput {
  const chosen =
    review.values.contactName === ''
      ? undefined
      : review.accessContacts.find((contact) => contact.id === contactChoice);
  return {
    proposalId: review.proposalId,
    revision: review.revision,
    reviewedAccessNotes: review.currentAccessNotes ?? '',
    contact: chosen ? { id: chosen.id, reviewedName: chosen.name, reviewedPhone: chosen.phone ?? '' } : null,
  };
}

/** The review's state and its submit: accept with the chosen contact, or reject with a reason. */
function useSiteAccessDecision(
  review: SiteAccessReview,
  accept: AcceptRunner,
  reject: RejectRunner,
  onClose: () => void,
) {
  const { showBanner } = useBanner();
  const router = useRouter();
  const [mode, setMode] = useState<'review' | 'reject'>('review');
  const { contactChoice, setContactChoice, reason, setReason, attempted, setAttempted } =
    useRevisionInput(review);
  const [failure, setFailure] = useState<string | null>(null);
  const contactChoiceError =
    review.values.contactName !== '' &&
    contactChoice !== NEW_CONTACT &&
    !review.accessContacts.some((contact) => contact.id === contactChoice)
      ? 'Wähle, welchen Zugangskontakt der Hinweis ersetzt.'
      : undefined;
  const reasonError = reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;

  const decide = (outcome: ReturnType<AcceptRunner['run']>, message: string) => {
    setFailure(null);
    void (async () => {
      // A transport failure answers like a refused save: the review stays open with its input.
      const result = await outcome.catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (!result.success) {
        if (REREAD_ON.has(result.error)) router.refresh();
        setFailure(describeFailure(result.error, DECISION_FAILURES, DECISION_FALLBACK));
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
      decide(
        reject.run({ proposalId: review.proposalId, revision: review.revision, reason: reason.trim() }),
        'Der Hinweis ist abgelehnt.',
      );
      return;
    }
    if (focusFirstInvalidField({ [CONTACT_CHOICE_ID]: contactChoiceError })) return;
    decide(accept.run(acceptInput(review, contactChoice)), 'Der Zugang ist beim Einsatzort gespeichert.');
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

/** The review the customer page opens for `?zugang=`, or why there is none to decide. */
export function SiteAccessReviewDialog({
  open,
  onOpenChange,
  read,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  read: SiteAccessReviewRead | 'failed';
}): ReactElement {
  const review = read !== 'failed' && read.state === 'open' ? read.review : null;
  const accept = useServerAction(acceptSiteAccessProposal);
  const reject = useServerAction(rejectSiteAccessProposal);
  const pending = accept.isPending || reject.isPending;
  const title = review ? `Zugang zu ${review.siteName} prüfen` : 'Zugangshinweis';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <DialogContent size={review ? 'lg' : 'md'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {review
              ? `${review.proposerName} hat am ${formatGermanDate(review.proposedAt)} beim Auftrag ${review.jobNumber ? `${review.jobNumber} ` : ''}„${review.jobTitle}“ einen anderen Zugang gemeldet.`
              : read === 'failed'
                ? 'Der Zugangshinweis konnte gerade nicht geladen werden. Öffne ihn in einem Moment erneut aus den Aufgaben.'
                : 'Dieser Zugangshinweis ist schon entschieden.'}
          </DialogDescription>
        </DialogHeader>
        {review ? (
          <SiteAccessReviewForm
            review={review}
            accept={accept}
            reject={reject}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Schließen
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SiteAccessReviewForm({
  review,
  accept,
  reject,
  onClose,
}: {
  review: SiteAccessReview;
  accept: AcceptRunner;
  reject: RejectRunner;
  onClose: () => void;
}): ReactElement {
  const decision = useSiteAccessDecision(review, accept, reject, onClose);
  const pending = accept.isPending || reject.isPending;
  return (
    <form onSubmit={decision.submit} className="contents" noValidate>
      <DialogBody className="space-y-4 py-1 text-sm wrap-anywhere">
        {review.siteAddress && <p className="text-muted-foreground">{review.siteAddress}</p>}
        <ProposedContact review={review} decision={decision} />
        <ProposedAccessNotes review={review} />
        {decision.mode === 'reject' && (
          <Field
            label="Begründung"
            htmlFor={REASON_ID}
            required
            description={`${review.proposerName} sieht die Begründung beim Auftrag. Der gemeldete Kontakt wird nicht gespeichert.`}
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
  );
}

/** The proposed Zugangskontakt and, while reviewing, which contact it becomes. */
function ProposedContact({
  review,
  decision,
}: {
  review: SiteAccessReview;
  decision: ReturnType<typeof useSiteAccessDecision>;
}): ReactElement | null {
  const { values } = review;
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
          {/* Every Zugangskontakt of the Einsatzort, searchable: any of them can be corrected. */}
          <SearchableSelect
            id={CONTACT_CHOICE_ID}
            value={decision.contactChoice}
            onChange={decision.setContactChoice}
            options={contactOptions(review)}
            placeholder="Bitte wählen"
            searchPlaceholder="Zugangskontakt suchen…"
          />
        </Field>
      )}
    </section>
  );
}

/** The proposed access notes beside the Einsatzort's current ones. */
function ProposedAccessNotes({ review }: { review: SiteAccessReview }): ReactElement | null {
  if (review.values.accessNotes === '') return null;
  return (
    <section className="space-y-1" aria-labelledby="site-access-notes-heading">
      <h3 id="site-access-notes-heading" className="font-medium">
        Zugangshinweis
      </h3>
      <p className="text-muted-foreground">
        {review.currentAccessNotes ? `Bisher: ${review.currentAccessNotes}` : 'Bisher ohne Zugangshinweis.'}
      </p>
      <p className="whitespace-pre-wrap">Neu: {review.values.accessNotes}</p>
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
