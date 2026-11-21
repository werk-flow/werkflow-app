import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// A delivery of a filed document as the office sees it, and the inputs of the
// send and record actions (supabase/migrations/20261219140000_record_document_deliveries.sql).
// The table checks repeat the limits.

/** What a delivery sends. Invoices now; offers and service reports join as kinds. */
export type DeliverySubject = { kind: 'invoice'; id: string };

export const DELIVERY_STATES = ['sending', 'sent', 'failed'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  sending: 'Wird versendet',
  sent: 'Versendet',
  failed: 'Fehlgeschlagen',
};

export const DELIVERY_CHANNELS = ['email', 'manual'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_LIMITS = { subject: 200, text: 5000, note: 500 } as const;

/** One delivery in the list of its subject, newest first. */
export type DeliveryEntry = {
  id: string;
  channel: DeliveryChannel;
  state: DeliveryState;
  /** Null for a manual delivery. */
  recipient: string | null;
  subject: string | null;
  note: string;
  attempts: number;
  /** A stable code of the last failure, never provider text. */
  failureCode: string | null;
  createdAt: string;
  sentAt: string | null;
  createdBy: string | null;
  /** Failed, or sending for ten minutes without an answer. */
  retryable: boolean;
};

export type DeliveryList = { total: number; entries: DeliveryEntry[] };

/** What the email form proposes; the office changes each before it sends. */
export type DeliveryMailDefaults = { recipient: string; subject: string; text: string };

/** An address the transport takes: one recipient, no display name. */
export const recipientSchema = z.email().max(254);

export const sendDocumentEmailSchema = z.object({
  /** One key per filled form: a repeated press sends nothing again. */
  attemptKey: uuidSchema,
  recipient: z.string().trim().pipe(recipientSchema),
  subject: z.string().trim().min(1).max(DELIVERY_LIMITS.subject),
  text: z.string().trim().max(DELIVERY_LIMITS.text),
});

export const recordManualDeliverySchema = z.object({
  attemptKey: uuidSchema,
  note: z.string().trim().max(DELIVERY_LIMITS.note),
});
