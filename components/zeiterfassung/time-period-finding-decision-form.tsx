'use client';

import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { decidePeriodFinding } from '@/lib/time-accounts/decision-actions';
import { getTimeAccountFailureMessage } from '@/lib/time-accounts/messages';

type FindingDecision = 'approved' | 'rejected';

/**
 * Approves or rejects one finding that needs a decision. Enter approves; the
 * refusal stays at the row. Outside the caller's approval scope it names who decides instead.
 */
export function TimePeriodFindingDecisionForm({
  periodId,
  findingId,
  findingLabel,
  canApprove,
}: {
  periodId: string;
  findingId: string;
  findingLabel: string;
  /** The reader asked the caller's approval scope for the finding's person. */
  canApprove: boolean;
}) {
  const { showBanner } = useBanner();
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('Geprüft');
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(decidePeriodFinding);

  const decide = async (decision: FindingDecision) => {
    setError(null);
    if (!reason.trim()) {
      setError('Gib eine Begründung an.');
      reasonRef.current?.focus();
      return;
    }
    const formData = new FormData();
    formData.set('periodId', periodId);
    formData.set('findingId', findingId);
    formData.set('decision', decision);
    formData.set('reason', reason);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getTimeAccountFailureMessage('decideFinding', result.error));
        return;
      }
      showBanner({
        variant: 'success',
        message:
          decision === 'approved' ? 'Der Prüfhinweis ist freigegeben.' : 'Der Prüfhinweis ist abgelehnt.',
      });
    } catch {
      setError(getTimeAccountFailureMessage('decideFinding', 'decision_failed'));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await decide('approved');
  };

  if (!canApprove)
    return <p className="text-sm text-muted-foreground">Wartet auf die Freigabe durch eine andere Person.</p>;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-2">
      <div className="flex items-center gap-2">
        <InlinePending active={isPending} keepSpace label="Entscheidung wird gespeichert" />
        <Input
          ref={reasonRef}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label={`Begründung für ${findingLabel}`}
          className="h-9 w-40"
        />
        <Button type="submit" size="sm" disabled={isPending} data-testid={`approve-finding-${findingId}`}>
          <CheckCircle2 className="size-4" />
          Freigeben
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={async () => decide('rejected')}
        >
          Ablehnen
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
