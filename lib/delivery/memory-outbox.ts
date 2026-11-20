import type { EmailMessage, SendEmailResult } from '@/lib/delivery/send-email';

// The transport of local and CI processes (lib/delivery/send-email.ts): it
// keeps each message in memory, once per idempotency key, and never reaches a
// provider. A test reads what was kept with `memoryOutbox.messages()`.

type KeptMessage = EmailMessage & { from: string; messageId: string };

const kept: KeptMessage[] = [];

export const memoryOutbox = {
  keep(message: EmailMessage & { from: string }): SendEmailResult {
    const earlier = kept.find((candidate) => candidate.idempotencyKey === message.idempotencyKey);
    if (earlier) return { status: 'accepted', messageId: earlier.messageId };
    const messageId = `memory-${kept.length + 1}`;
    kept.push({ ...message, messageId });
    return { status: 'accepted', messageId };
  },
  /** What was kept, oldest first; always empty on a hosted deployment. */
  messages(): readonly KeptMessage[] {
    return kept;
  },
};
