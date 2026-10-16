import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { labContextSchema, labCount as count, labMetricSchema as metricSchema } from './lab-record';
import { LAB_METRICS } from './lab-steps';

/**
 * The bounds of a lab reference and the history that wrote them
 * (docs/technical/performance.md, "Change a lab reference"). The history opens
 * with a snapshot of every bound and records the full new bound of every later
 * change, so replaying it from the snapshot must give the stored bounds. A
 * hand edit of lib/testing/lab-count-references.json therefore fails
 * `replayProblems`, which `labReferenceProblems` runs on every read.
 */

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const countReferenceSchema = z.object({ reference: count, tolerance: count }).strict();
export const byteToleranceSchema = z.object({ relative: z.number().min(0).max(1), absolute: count }).strict();
const byteReferenceSchema = z.object({ reference: count, tolerance: byteToleranceSchema }).strict();
const payloadReferenceSchema = z
  .object({
    requests: countReferenceSchema,
    encodedBytes: byteReferenceSchema,
    decodedBytes: byteReferenceSchema.nullable(),
    rows: countReferenceSchema.nullable(),
  })
  .strict();
export const labCountsSchema = z.partialRecord(metricSchema, countReferenceSchema);
export const labPayloadsSchema = z.record(z.string(), payloadReferenceSchema);

export type CountReference = z.infer<typeof countReferenceSchema>;
export type PayloadReference = z.infer<typeof payloadReferenceSchema>;
type LabCounts = z.infer<typeof labCountsSchema>;
type LabPayloads = z.infer<typeof labPayloadsSchema>;
type LabContext = z.infer<typeof labContextSchema>;

const runKeysSchema = z.array(z.string().min(1)).min(1);
const reasonSchema = z.string().min(1);

/** The history entry of the first file version, which recorded no values. Kept inside a `migrated` entry. */
export const legacyHistoryEntrySchema = z
  .object({
    kind: z.enum(['initial', 'ratchet', 'raise', 'floor-accept', 'shape-accept', 'ungate']),
    target: z.string().min(1),
    from: count.nullable(),
    to: count.nullable(),
    runKeys: runKeysSchema,
    reason: z.string().min(1).nullable(),
  })
  .strict();

/** A calibration: every bound the step starts with, from five runs on one build. */
const initialEntrySchema = z
  .object({
    kind: z.literal('initial'),
    runKeys: runKeysSchema,
    reason: reasonSchema,
    context: labContextSchema,
    counts: labCountsSchema,
    payloads: labPayloadsSchema,
  })
  .strict();

/**
 * The one-time snapshot that made a first-version history replayable: the
 * bounds the last lab runs were judged against, with the entries it replaced.
 */
const migratedEntrySchema = z
  .object({
    kind: z.literal('migrated'),
    runKeys: runKeysSchema,
    reason: reasonSchema,
    context: labContextSchema,
    counts: labCountsSchema,
    payloads: labPayloadsSchema,
    superseded: z.array(legacyHistoryEntrySchema).min(1),
  })
  .strict();

/** A lower count reference from a passing run; the tolerance stays. */
const ratchetEntrySchema = z
  .object({
    kind: z.literal('ratchet'),
    target: metricSchema,
    from: countReferenceSchema,
    to: countReferenceSchema,
    runKeys: runKeysSchema,
    reason: reasonSchema.nullable(),
  })
  .strict();

/** A higher count reference accepted with the reviewer's reason. */
const raiseEntrySchema = z
  .object({
    kind: z.literal('raise'),
    target: metricSchema,
    from: countReferenceSchema,
    to: countReferenceSchema,
    runKeys: runKeysSchema,
    reason: reasonSchema,
  })
  .strict();

/** A count that left the step: unstable on it (`ungate`) or rejected for every step (`reject`). */
const removalEntrySchema = z
  .object({
    kind: z.enum(['ungate', 'reject']),
    target: metricSchema,
    from: countReferenceSchema,
    to: z.null(),
    runKeys: runKeysSchema,
    reason: reasonSchema,
  })
  .strict();

/** An accepted payload change: larger, smaller, or a shape that appeared or stopped. */
const payloadEntrySchema = z
  .object({
    kind: z.enum(['ceiling-accept', 'floor-accept', 'shape-accept']),
    target: z.string().min(1),
    from: payloadReferenceSchema.nullable(),
    to: payloadReferenceSchema.nullable(),
    runKeys: runKeysSchema,
    reason: reasonSchema,
  })
  .strict();

/** A reviewed carry-over entry that re-keyed the reference to its step's new measurement digest. */
const carryOverEntrySchema = z
  .object({ kind: z.literal('carry-over'), fromDigest: sha256, toDigest: sha256, reason: reasonSchema })
  .strict();

export const labHistoryEntrySchema = z.discriminatedUnion('kind', [
  initialEntrySchema,
  migratedEntrySchema,
  ratchetEntrySchema,
  raiseEntrySchema,
  removalEntrySchema,
  payloadEntrySchema,
  carryOverEntrySchema,
]);
export type LabHistoryEntry = z.infer<typeof labHistoryEntrySchema>;

type Bounds = { context: LabContext; counts: LabCounts; payloads: LabPayloads };

function show(value: unknown): string {
  return value === undefined ? 'absent' : JSON.stringify(value);
}

/** Applies one change entry to the replayed bounds, or names why it does not start from them. */
function applyEntry(bounds: Bounds, entry: LabHistoryEntry, index: number): string | null {
  const at = `history[${index}] ${entry.kind}`;
  switch (entry.kind) {
    case 'initial':
    case 'migrated':
      return `${at} is a snapshot after the first entry; a recalibration replaces the whole reference`;
    case 'carry-over':
      if (bounds.context.measurementDigest !== entry.fromDigest)
        return `${at} starts from digest ${entry.fromDigest}, but the history replays ${bounds.context.measurementDigest}`;
      bounds.context = { ...bounds.context, measurementDigest: entry.toDigest };
      return null;
    case 'ceiling-accept':
    case 'floor-accept':
    case 'shape-accept': {
      const current = bounds.payloads[entry.target] ?? null;
      if (!isDeepStrictEqual(current, entry.from))
        return `${at} ${entry.target} starts from ${show(entry.from)}, but the history replays ${show(current)}`;
      const payloads = { ...bounds.payloads };
      if (entry.to) payloads[entry.target] = entry.to;
      else delete payloads[entry.target];
      bounds.payloads = payloads;
      return null;
    }
    case 'ratchet':
    case 'raise':
    case 'ungate':
    case 'reject': {
      const current = bounds.counts[entry.target];
      if (!isDeepStrictEqual(current, entry.from))
        return `${at} ${entry.target} starts from ${show(entry.from)}, but the history replays ${show(current)}`;
      const counts = { ...bounds.counts };
      if (entry.to) counts[entry.target] = entry.to;
      else delete counts[entry.target];
      bounds.counts = counts;
      // The entry still applies, so one forged ratchet is one problem.
      return entry.kind === 'ratchet' &&
        (entry.to.reference > entry.from.reference || entry.to.tolerance !== entry.from.tolerance)
        ? `${at} raised ${entry.target} from ${show(entry.from)} to ${show(entry.to)}; a ratchet only lowers the reference`
        : null;
    }
  }
}

/** Each field where the stored bounds differ from the replayed ones, by its path in the reference. */
function boundDifferences(stored: Bounds, replayed: Bounds): string[] {
  const differences: string[] = [];
  const compare = (path: string, left: unknown, right: unknown) => {
    if (!isDeepStrictEqual(left, right))
      differences.push(`${path} is ${show(left)}, but its history replays ${show(right)}`);
  };
  const storedContext: Record<string, unknown> = stored.context;
  const replayedContext: Record<string, unknown> = replayed.context;
  for (const key of new Set([...Object.keys(storedContext), ...Object.keys(replayedContext)]))
    compare(`context.${key}`, storedContext[key], replayedContext[key]);
  for (const metric of LAB_METRICS)
    compare(`counts.${metric}`, stored.counts[metric], replayed.counts[metric]);
  const shapes = new Set([...Object.keys(stored.payloads), ...Object.keys(replayed.payloads)]);
  for (const shape of [...shapes].sort()) {
    const left = stored.payloads[shape];
    const right = replayed.payloads[shape];
    if (!left || !right) {
      compare(`payloads.${shape}`, left, right);
      continue;
    }
    for (const field of ['requests', 'encodedBytes', 'decodedBytes', 'rows'] as const)
      compare(`payloads.${shape}.${field}`, left[field], right[field]);
  }
  return differences;
}

/**
 * Replays a reference's history from its opening snapshot and names every
 * entry that does not start from the replayed bounds and every stored field
 * that differs from the result.
 */
export function replayProblems(stored: Bounds & { history: readonly LabHistoryEntry[] }): string[] {
  const [first, ...later] = stored.history;
  if (!first || (first.kind !== 'initial' && first.kind !== 'migrated'))
    return ['the history does not open with an initial or migrated snapshot, so it cannot be replayed'];
  const bounds: Bounds = { context: first.context, counts: first.counts, payloads: first.payloads };
  const problems: string[] = [];
  later.forEach((entry, index) => {
    const problem = applyEntry(bounds, entry, index + 1);
    if (problem) problems.push(problem);
  });
  return [...problems, ...boundDifferences(stored, bounds)];
}
