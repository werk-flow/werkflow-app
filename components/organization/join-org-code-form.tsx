'use client';

import { useState, type ReactNode } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useReportPending } from '@/hooks/use-report-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { requestOrganizationJoin } from '@/lib/org/join-request-actions';
import type { OwnJoinRequest } from '@/lib/org/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const CODE_REQUIRED_MESSAGE = 'Bitte gib einen Organisationscode ein.';
const JOIN_MESSAGES: Readonly<Record<string, string>> = {
  code_required: CODE_REQUIRED_MESSAGE,
  invalid_code: 'Ungültiger Organisationscode.',
  too_many_attempts: 'Zu viele Fehlversuche. Bitte versuche es in einer Stunde erneut.',
  admin_mismatch:
    'Du kannst keiner Organisation beitreten, die nicht vom gleichen Admin stammt wie deine bestehenden Organisationen.',
  already_member: 'Du bist bereits Mitglied dieser Organisation.',
};
const JOIN_FALLBACK = 'Die Anfrage konnte nicht gesendet werden. Bitte versuche es erneut.';

/**
 * The organization code field. A valid code sends a join request; the open
 * request, new or one the person already had, goes to `onRequest`.
 * `renderActions` places the submit button for the host (page or dialog).
 */
export function JoinOrgCodeForm({
  inputId,
  onRequest,
  renderActions,
  onPendingChange,
}: {
  inputId: string;
  onRequest: (request: OwnJoinRequest) => void;
  renderActions: (isPending: boolean) => ReactNode;
  /** Reports the request's pending state so a hosting dialog stays open while it runs. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = useServerAction(requestOrganizationJoin);
  const codeError = code.trim() ? undefined : CODE_REQUIRED_MESSAGE;
  useReportPending(join.isPending, onPendingChange);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    if (focusFirstInvalidField({ [inputId]: codeError })) return;
    const result = await join.run(code).catch(() => ({
      success: false as const,
      error: 'unexpected_error' as const,
    }));
    if (result.success || result.error === 'request_pending') {
      onRequest(result.request);
      return;
    }
    setError(describeFailure(result.error, JOIN_MESSAGES, JOIN_FALLBACK));
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
      <Field label="Organisationscode" htmlFor={inputId} required error={attempted ? codeError : undefined}>
        <Input
          type="text"
          placeholder="z. B. ABC123"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          disabled={join.isPending}
          autoFocus
          autoComplete="off"
          className="uppercase"
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      {renderActions(join.isPending)}
    </form>
  );
}
