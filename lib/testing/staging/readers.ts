// What a staging journey reads besides the page: DEV rows of its own organization, and Stripe sandbox
// objects (.claude/skills/staging-journey/SKILL.md). A reader returns ids, states, amounts and times
// only, so nothing it hands a journey can print personal data (Tier 1).

import { isUuid } from '../../validation/uuid';
import { StagingFailure } from './runs';
import { z } from '../../zod';

/**
 * The columns a journey may read, per table. Each holds an id, a state, an amount or a time: never a
 * name, an address, a buyer, a line text or free text. A journey that needs another column adds it here.
 */
const READABLE_COLUMNS = {
  organizations: ['id', 'created_at'],
  werkflow_subscriptions: [
    'status',
    'holds_subscription',
    'runs_subscription',
    'cancel_at_period_end',
    'cancellation_reason',
    'stripe_customer_id',
    'stripe_subscription_id',
    'checkout_session_id',
  ],
  werkflow_billing_mails: ['id', 'kind', 'state', 'attempts', 'failure_code', 'stripe_object_id', 'sent_at'],
  werkflow_invoices: [
    'id',
    'number',
    'type_code',
    'issued_at',
    'gross_cents',
    'net_cents',
    'tax_cents',
    'due_cents',
    'paid_cents',
    'currency',
    'payment_means',
    'stripe_invoice_id',
    'stripe_credit_note_id',
    'storno_of_invoice_id',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ReadableTable = keyof typeof READABLE_COLUMNS;

export type ScopedRead<T extends ReadableTable = ReadableTable> = {
  table: T;
  columns: readonly (typeof READABLE_COLUMNS)[T][number][];
  organizationId: string;
};

const READABLE = new Map<string, readonly string[]>(Object.entries(READABLE_COLUMNS));

function isReadable(table: string, column: string): boolean {
  return READABLE.get(table)?.includes(column) ?? false;
}

/**
 * The read-only SQL for one table's rows of one organization, with the organization as a parameter.
 * A table or column outside the allowlist refuses the read, whatever the caller's types said.
 */
export function scopedReadQuery(read: {
  table: string;
  columns: readonly string[];
  organizationId: string;
}): { query: string; parameters: string[] } {
  if (read.columns.length === 0) throw new StagingFailure('Name at least one column.');
  for (const column of read.columns)
    if (!isReadable(read.table, column))
      throw new StagingFailure(
        `${read.table}.${column} is no readable id or state column (lib/testing/staging/readers.ts).`,
      );
  if (!isUuid(read.organizationId)) throw new StagingFailure('The organization id is no UUID.');
  const scope = read.table === 'organizations' ? 'id' : 'organization_id';
  return {
    query: `select ${read.columns.join(', ')} from public.${read.table} where ${scope} = $1::uuid`,
    parameters: [read.organizationId],
  };
}

/** The Stripe fields a journey may read: ids, states, amounts and times, never a customer's details. */
const STRIPE_FIELDS = [
  'id',
  'object',
  'livemode',
  'status',
  'created',
  'canceled_at',
  'cancel_at_period_end',
  'currency',
  'amount_due',
  'amount_paid',
  'amount_refunded',
  'total',
  'paid',
  'number',
  'customer',
  'subscription',
  'invoice',
  'payment_intent',
  'latest_invoice',
] as const;

export type StripeFacts = Partial<Record<(typeof STRIPE_FIELDS)[number], string | number | boolean | null>>;

const sandboxObject = z.object({ livemode: z.literal(false) });
const sandboxList = z.object({ object: z.literal('list'), data: z.array(sandboxObject) });
const record = z.record(z.string(), z.unknown());
const expandedId = z.object({ id: z.string() });

/** An object's allowed fields; an expanded object stands as its id, anything else is left out. */
function factsOf(body: unknown): StripeFacts {
  const source = record.parse(body);
  const facts: StripeFacts = {};
  for (const field of STRIPE_FIELDS) {
    const value = source[field];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      facts[field] = z.union([z.string(), z.number(), z.boolean(), z.null()]).parse(value);
    else if (expandedId.safeParse(value).success) facts[field] = expandedId.parse(value).id;
  }
  return facts;
}

/**
 * A Stripe answer from the sandbox as its allowed fields, or a throw: an object answers
 * `livemode: false`, a list's every item does. The message names no field of the body.
 */
export function sandboxAnswer(body: unknown): StripeFacts[] {
  const isList = z.object({ object: z.literal('list') }).safeParse(body).success;
  // A list passes only when every item is a sandbox object; it never falls back to the object check.
  if (isList && sandboxList.safeParse(body).success)
    return z
      .object({ data: z.array(z.unknown()) })
      .parse(body)
      .data.map(factsOf);
  if (!isList && sandboxObject.safeParse(body).success) return [factsOf(body)];
  throw new StagingFailure('Stripe answered something other than a sandbox object; the journey stops.');
}
