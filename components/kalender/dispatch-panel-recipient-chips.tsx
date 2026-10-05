import { DISPATCH_RECIPIENT_STATE_LABELS, type DispatchRecipientView } from '@/lib/dispatch/types';

export function RecipientChips({ recipients }: { recipients: DispatchRecipientView[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {recipients.map((recipient) => (
        <span
          key={recipient.employeeRecordId}
          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]"
          data-recipient-state={recipient.state}
          title={`${recipient.displayName}: ${DISPATCH_RECIPIENT_STATE_LABELS[recipient.state]}${
            recipient.challengeReason ? ` – ${recipient.challengeReason}` : ''
          }`}
        >
          {recipient.displayName} · {DISPATCH_RECIPIENT_STATE_LABELS[recipient.state]}
        </span>
      ))}
    </div>
  );
}
