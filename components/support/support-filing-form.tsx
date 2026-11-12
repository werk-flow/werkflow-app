'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { AttachmentsField } from '@/components/problem-reports/attachments-field';
import { useReportFiles, type ChosenAttachment } from '@/components/problem-reports/use-report-files';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { logError } from '@/lib/logging';
import { problemReportFileFailureMessage } from '@/lib/problem-reports/messages';
import {
  createSupportReportFileUploadTicket,
  fileProblemReportForCaller,
  finalizeSupportReportFileUpload,
} from '@/lib/problem-reports/support-actions';
import { supportFailureMessage } from '@/lib/problem-reports/support-messages';
import { supportReportHref } from '@/lib/problem-reports/support-queue-query';
import {
  PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH,
  type SupportFilingOptions,
} from '@/lib/problem-reports/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

// A report support files for a member who phoned. The member is the
// reporter and sees it in „Meine Meldungen“; support is the filer and adds
// the attachments. The report saves first, once, under an id this form
// chose; a file that fails keeps the saved report, and the next press sends
// only what is missing. A completed filing leaves for the report's page; the
// router keeps this page hidden with its state (`cacheComponents`), so the
// next visit starts a fresh form.

const ORGANIZATION_ID = 'support-filing-organization';
const MEMBER_ID = 'support-filing-member';
const DESCRIPTION_ID = 'support-filing-description';
const MAYBE_SAVED =
  'Die Meldung kam vielleicht nicht an. Prüfe deine Verbindung und drücke noch einmal auf „Meldung aufnehmen“. Organisation, Person und Beschreibung bleiben dafür, wie sie sind.';
/** Refusals the action answers before it writes anything. */
const REFUSED_BEFORE_SAVING: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_authenticated',
  'not_authorized',
  'support_unavailable',
  'reporter_not_member',
  'report_conflict',
]);

type Errors = Partial<
  Record<typeof ORGANIZATION_ID | typeof MEMBER_ID | typeof DESCRIPTION_ID, string | undefined>
>;
type Filing = { organizationId: string; memberId: string; description: string };
type SavedFiling = { reportId: string; number: number };

/**
 * Saving the report and then its attachments. A save that reached the server
 * may have stored the report, whatever its answer: from then on its
 * organization, member and description stay as sent (`frozen`).
 */
function useSupportFiling(onCompleted: () => void) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedFiling | null>(null);
  // Chosen once per form: a retry after a lost answer saves the same report.
  const [reportId] = useState(() => crypto.randomUUID());
  const [saveMayHaveStored, setSaveMayHaveStored] = useState(false);
  const files = useReportFiles((report, file, code) => {
    const reason = problemReportFileFailureMessage(code, file.kind);
    setError(
      `Die Meldung Nr. ${report.number} ist gespeichert, aber „${file.fileName}“ fehlt noch. ${reason}`,
    );
  });

  const save = async (filing: Filing): Promise<SavedFiling | null> => {
    if (saved) return saved;
    const earlier = saveMayHaveStored;
    setSaveMayHaveStored(true);
    const result = await fileProblemReportForCaller({
      organizationId: filing.organizationId,
      reporterId: filing.memberId,
      reportId,
      description: filing.description,
    });
    if (!result.success) {
      const storedNothing = REFUSED_BEFORE_SAVING.has(result.error);
      if (storedNothing) setSaveMayHaveStored(earlier);
      setError(storedNothing ? supportFailureMessage(result.error) : MAYBE_SAVED);
      return null;
    }
    const report = { reportId: result.reportId, number: result.number };
    setSaved(report);
    return report;
  };

  const send = (filing: Filing, attachments: readonly ChosenAttachment[]): void => {
    setError(null);
    void run(async () => {
      let report = saved;
      try {
        report = await save(filing);
        if (!report) return;
        const keyed = attachments.map(({ key, file }) => ({
          key: `anhang-${key}`,
          file: { kind: 'anhang' as const, bytes: file, fileName: file.name },
        }));
        const actions = {
          createTicket: createSupportReportFileUploadTicket,
          finalize: finalizeSupportReportFileUpload,
        };
        if (!(await files.send(actions, filing.organizationId, report, keyed))) return;
        showBanner({
          variant: 'success',
          message: `Die Meldung Nr. ${report.number} ist aufgenommen. Die Person sieht sie in „Meine Meldungen“.`,
        });
        onCompleted();
        router.push(supportReportHref(report.reportId));
        await untilPageLeaves();
      } catch (thrown) {
        logError('useSupportFiling: filing failed', thrown);
        setError(report ? supportFailureMessage('send_interrupted') : MAYBE_SAVED);
      }
    });
  };

  return { send, isPending, error, frozen: saved !== null || saveMayHaveStored, frozenFiles: files.frozen };
}

/** What is missing before the report can be saved. */
function filingErrors(filing: {
  organizationId: string | null;
  memberId: string;
  description: string;
}): Errors {
  const { description } = filing;
  return {
    [ORGANIZATION_ID]: filing.organizationId ? undefined : 'Wähle die Organisation der Person aus.',
    [MEMBER_ID]: filing.memberId ? undefined : 'Wähle aus, wer angerufen hat.',
    [DESCRIPTION_ID]: !description
      ? 'Beschreibe, was die Person gemeldet hat.'
      : description.length > PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH
        ? `Die Beschreibung ist zu lang. Kürze sie auf höchstens ${PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH} Zeichen.`
        : undefined,
  };
}

type CallerFieldsProps = {
  options: SupportFilingOptions;
  organizationId: string | null;
  memberId: string;
  onMemberChange: (memberId: string) => void;
  errors: Errors;
  disabled: boolean;
};

/** The organization, which the address holds, and the member who phoned. */
function CallerFields({
  options,
  organizationId,
  memberId,
  onMemberChange,
  errors,
  disabled,
}: CallerFieldsProps) {
  const navigation = useListNavigation();
  return (
    <>
      <Field label="Organisation" htmlFor={ORGANIZATION_ID} required error={errors[ORGANIZATION_ID]}>
        <SearchableSelect
          id={ORGANIZATION_ID}
          value={organizationId ?? ''}
          onChange={(next) => {
            onMemberChange('');
            navigation.navigate({ organisation: next || null });
          }}
          options={options.organizations.map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
          placeholder="Organisation auswählen"
          searchPlaceholder="Organisation suchen"
          emptyMessage="Keine Organisation gefunden"
          disabled={disabled}
          loading={navigation.busy}
        />
      </Field>
      <Field
        label="Wer hat angerufen?"
        htmlFor={MEMBER_ID}
        required
        description={organizationId ? undefined : 'Wähle zuerst die Organisation aus.'}
        error={errors[MEMBER_ID]}
      >
        <SearchableSelect
          id={MEMBER_ID}
          value={memberId}
          onChange={onMemberChange}
          options={options.members.map((member) => ({ value: member.userId, label: member.name }))}
          placeholder="Person auswählen"
          searchPlaceholder="Person suchen"
          emptyMessage={organizationId ? 'Keine Person gefunden' : 'Wähle zuerst die Organisation aus.'}
          disabled={disabled || navigation.busy}
        />
      </Field>
    </>
  );
}

type SupportFilingFormProps = {
  options: SupportFilingOptions;
  /** The chosen organization, from the address; null while none is chosen. */
  organizationId: string | null;
};

/**
 * The filing form, fresh after each completed filing: when the page that
 * filed goes out of view, its pending task and its saved report go with the
 * form, and the next visit files a new report. A filing that completes while
 * the page is already out of view starts the fresh form at once.
 */
export function SupportFilingForm(props: SupportFilingFormProps) {
  const [generation, setGeneration] = useState(0);
  // Refs, not state: a completion and the hide can land in one render, and
  // the reset must not wait for an effect that a hidden page never mounts.
  const inView = useRef(false);
  const completed = useRef(false);
  // A layout effect ends within the commit that hides or unmounts the page.
  useLayoutEffect(() => {
    inView.current = true;
    return () => {
      inView.current = false;
      if (!completed.current) return;
      completed.current = false;
      setGeneration((current) => current + 1);
    };
  }, []);
  const onCompleted = (): void => {
    if (inView.current) completed.current = true;
    else setGeneration((current) => current + 1);
  };
  return <FilingForm key={generation} {...props} onCompleted={onCompleted} />;
}

/** A member chosen for one organization; another organization shows no member. */
type MemberChoice = { organizationId: string; memberId: string };

function FilingForm({
  options,
  organizationId,
  onCompleted,
}: SupportFilingFormProps & { onCompleted: () => void }) {
  const filing = useSupportFiling(onCompleted);
  const [memberChoice, setMemberChoice] = useState<MemberChoice | null>(null);
  const memberId =
    memberChoice && memberChoice.organizationId === organizationId ? memberChoice.memberId : '';
  const setMemberId = (next: string): void =>
    setMemberChoice(organizationId && next ? { organizationId, memberId: next } : null);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<ChosenAttachment[]>([]);
  const [errors, setErrors] = useState<Errors>({});

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = description.trim();
    const found = filingErrors({ organizationId, memberId, description: text });
    setErrors(found);
    if (focusFirstInvalidField(found) || !organizationId) return;
    filing.send({ organizationId, memberId, description: text }, attachments);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <CallerFields
        options={options}
        organizationId={organizationId}
        memberId={memberId}
        onMemberChange={setMemberId}
        errors={errors}
        disabled={filing.isPending || filing.frozen}
      />
      <Field
        label="Was hat die Person gemeldet?"
        htmlFor={DESCRIPTION_ID}
        required
        description="So genau, wie sie es am Telefon gesagt hat: was sie tun wollte und was stattdessen passiert ist."
        error={errors[DESCRIPTION_ID]}
      >
        <Textarea
          value={description}
          disabled={filing.isPending || filing.frozen}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <AttachmentsField
        attachments={attachments}
        onAttachmentsChange={(update) => setAttachments(update)}
        frozenFiles={filing.frozenFiles}
        disabled={filing.isPending}
      />
      <ErrorText>{filing.error}</ErrorText>
      <Button type="submit" pending={filing.isPending} disabled={filing.isPending}>
        Meldung aufnehmen
      </Button>
    </form>
  );
}
