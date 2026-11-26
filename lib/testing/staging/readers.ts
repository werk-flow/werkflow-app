// What a staging journey reads besides the page: DEV rows of its own organization, and Stripe sandbox
// objects (.claude/skills/staging-journey/SKILL.md). A reader returns ids and states only, so nothing it
// hands a journey can print personal data.

import { isUuid } from '../../validation/uuid';
import { z } from '../../zod';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
/** Columns that hold ids, times, states and counts: never a name, an address or free text. */
const ID_OR_STATE_COLUMN =
  /^(?:id|[a-z_]+_id|[a-z_]+_ids|[a-z_]+_at|state|status|kind|attempts|[a-z_]+_code|[a-z_]+_reason|holds_[a-z_]+|runs_[a-z_]+|[a-z_]+_count|number|cancel_at_period_end|livemode)$/;

export type ScopedRead = { table: string; columns: readonly string[]; organizationId: string };

/**
 * The read-only SQL for one table's rows of one organization, with the organization as a parameter.
 * A table or column outside the id-and-state shape refuses the read.
 */
export function scopedReadQuery(read: ScopedRead): { query: string; parameters: string[] } {
  if (!IDENTIFIER.test(read.table)) throw new Error(`The table ${read.table} is no plain identifier.`);
  if (read.columns.length === 0) throw new Error('Name at least one column.');
  for (const column of read.columns)
    if (!IDENTIFIER.test(column) || !ID_OR_STATE_COLUMN.test(column))
      throw new Error(`The column ${column} holds no id or state; a staging reader returns only those.`);
  if (!isUuid(read.organizationId)) throw new Error('The organization id is no UUID.');
  const scope = read.table === 'organizations' ? 'id' : 'organization_id';
  return {
    query: `select ${read.columns.join(', ')} from public.${read.table} where ${scope} = $1::uuid`,
    parameters: [read.organizationId],
  };
}

const sandboxObject = z.object({ livemode: z.literal(false) });
const sandboxList = z.object({ object: z.literal('list'), data: z.array(sandboxObject) });
const record = z.record(z.string(), z.unknown());

/**
 * A Stripe answer from the sandbox, or a throw: an object answers `livemode: false`, a list's every
 * item does. The message names no field of the body.
 */
export function sandboxAnswer(body: unknown): Record<string, unknown> {
  if (sandboxList.safeParse(body).success || sandboxObject.safeParse(body).success) return record.parse(body);
  throw new Error('Stripe answered something other than a sandbox object; the journey stops.');
}
