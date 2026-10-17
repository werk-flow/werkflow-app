// An owner doc's checklist could lose its mechanisms one retag at a time: an item tagged
// [judgment] needs no test, so its test can go. lib/docs/judgment-ratchet.json records the
// [judgment] tags of each owner doc; the count may fall and the file then records the lower
// number, and it rises only with an owner-approved reason in the same change.

import { isJsonRecord as isRecord } from '../supabase/json';

/** One owner doc's recorded count, with the owner's reason when the count was raised. */
type JudgmentEntry = { judgment: number; raisedBecause?: string };

export type JudgmentRatchet = Readonly<Record<string, JudgmentEntry>>;

/** The ratchet from parsed JSON; throws on any other shape. */
export function parseJudgmentRatchet(value: unknown): JudgmentRatchet {
  if (!isRecord(value)) throw new Error('lib/docs/judgment-ratchet.json must hold an object of owner docs');
  const ratchet: Record<string, JudgmentEntry> = {};
  for (const [doc, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.judgment !== 'number')
      throw new Error(`lib/docs/judgment-ratchet.json: the entry of ${doc} needs a numeric "judgment"`);
    const reason = entry.raisedBecause;
    ratchet[doc] =
      typeof reason === 'string'
        ? { judgment: entry.judgment, raisedBecause: reason }
        : { judgment: entry.judgment };
  }
  return ratchet;
}

/**
 * Problems between the counted [judgment] tags and the recorded ratchet: an owner doc above
 * its record, a record above the count (lower it), a record that rose against the committed
 * one without a reason, and a doc missing from either side.
 */
export function findJudgmentRatchetProblems(
  counted: ReadonlyMap<string, number>,
  recorded: JudgmentRatchet,
  committed: JudgmentRatchet | null,
): string[] {
  const problems: string[] = [];
  for (const [doc, count] of counted) {
    const entry = recorded[doc];
    if (entry === undefined) {
      problems.push(`${doc} has ${count} [judgment] tags but no entry in lib/docs/judgment-ratchet.json`);
      continue;
    }
    if (count > entry.judgment)
      problems.push(
        `${doc} has ${count} [judgment] tags, more than its recorded ${entry.judgment}; name the mechanism that enforces the new item instead`,
      );
    if (count < entry.judgment)
      problems.push(
        `${doc} has ${count} [judgment] tags; lower its entry in lib/docs/judgment-ratchet.json from ${entry.judgment}`,
      );
    const before = committed?.[doc];
    const reason = entry.raisedBecause?.trim() ?? '';
    if (
      before !== undefined &&
      entry.judgment > before.judgment &&
      (reason === '' || reason === before.raisedBecause)
    )
      problems.push(
        `the entry of ${doc} rose from ${before.judgment} to ${entry.judgment} without a new "raisedBecause" naming the owner's reason`,
      );
  }
  for (const doc of Object.keys(recorded)) {
    if (!counted.has(doc))
      problems.push(`lib/docs/judgment-ratchet.json names ${doc}, which is no owner doc`);
  }
  return problems;
}
