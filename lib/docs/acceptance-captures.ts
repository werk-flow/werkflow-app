import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from '../zod';
import { browserRunPaths } from '../testing/runs/run-paths';
import { hasClosedRecordBanner } from './closed-records';

/**
 * Rendered acceptance evidence (docs/technical/standards-audit.md, "Rendered
 * design acceptance"). The capture fixture (tests/audit/support/acceptance-captures.ts)
 * writes each image under `<run>/acceptance/<set>/` with an entry in
 * `<run>/acceptance/index.json`. An open plan record cites one as
 * `` `capture:<run-key>/<set>/<capture>-<width>-<scheme>` ``; `docs:check`
 * accepts the citation only when the image belongs to a passed test of that run
 * and still has the bytes that were captured. A closed record is history and
 * is not checked.
 */

export const ACCEPTANCE_INDEX_FILE = 'index.json';

const entrySchema = z
  .object({
    set: z.string().min(1),
    capture: z.string().min(1),
    /** `<set>/<capture>-<width>-<scheme>.png`, relative to the acceptance folder. */
    file: z.string().min(1),
    testId: z.string().min(1),
    route: z.string().min(1),
    /** The app role, or the session of a screen outside the app shell. */
    role: z.enum(['admin', 'employee', 'anonymous', 'newcomer', 'subscriber', 'prestart']),
    view: z.enum(['page', 'tab', 'dialog', 'standalone']),
    width: z.number().int().positive(),
    height: z.number().int().nonnegative(),
    scheme: z.enum(['light', 'dark']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: z.iso.datetime(),
    status: z.enum(['captured', 'passed', 'failed']),
  })
  .strict();

export const acceptanceIndexSchema = z
  .object({ version: z.literal(1), entries: z.array(entrySchema) })
  .strict();

export type AcceptanceEntry = z.infer<typeof entrySchema>;

const manifestOutcomesSchema = z.object({
  outcomes: z
    .array(z.object({ id: z.string(), status: z.string() }))
    .optional()
    .default([]),
});

const CITATION = /`capture:([A-Za-z0-9][A-Za-z0-9._-]*)\/([a-z0-9-]+\/[A-Za-z0-9._-]+)`/g;

export type CaptureCitation = { line: number; runKey: string; file: string };

export function findCaptureCitations(markdown: string): CaptureCitation[] {
  return markdown.split('\n').flatMap((text, index) =>
    [...text.matchAll(CITATION)].map((match) => ({
      line: index + 1,
      runKey: match[1] ?? '',
      file: `${match[2] ?? ''}.png`,
    })),
  );
}

/** A run file's JSON, or `null` when it does not parse; its schema then reports it as malformed. */
function parsedRunFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function citationProblem(repositoryRoot: string, citation: CaptureCitation): string | null {
  let directory: string;
  try {
    directory = browserRunPaths(repositoryRoot, citation.runKey).directory;
  } catch {
    return `run key ${citation.runKey} is not a valid run key`;
  }
  const manifestPath = resolve(directory, 'manifest.json');
  const indexPath = resolve(directory, 'acceptance', ACCEPTANCE_INDEX_FILE);
  if (!existsSync(manifestPath) || !existsSync(indexPath))
    return `run ${citation.runKey} is not on this workstation; capture it again or close the record`;
  const index = acceptanceIndexSchema.safeParse(parsedRunFile(indexPath));
  if (!index.success) return `the acceptance index of run ${citation.runKey} is malformed`;
  const entry = index.data.entries.find((candidate) => candidate.file === citation.file);
  if (!entry) return `run ${citation.runKey} holds no capture ${citation.file}`;
  if (entry.status !== 'passed')
    return `capture ${citation.file} is ${entry.status}: only the capture of a passed test is evidence`;
  const manifest = manifestOutcomesSchema.safeParse(parsedRunFile(manifestPath));
  if (!manifest.success) return `the manifest of run ${citation.runKey} is malformed`;
  const outcome = manifest.data.outcomes.find((candidate) => candidate.id === entry.testId);
  if (outcome?.status !== 'passed')
    return `the test of capture ${citation.file} did not pass in run ${citation.runKey}`;
  const imagePath = resolve(directory, 'acceptance', citation.file);
  if (!existsSync(imagePath)) return `the image of capture ${citation.file} is missing`;
  const digest = createHash('sha256').update(readFileSync(imagePath)).digest('hex');
  if (digest !== entry.sha256) return `the image of capture ${citation.file} changed after it was captured`;
  return null;
}

/** Every unresolvable capture citation of the open records among `records`. */
export function findCaptureCitationProblems(
  repositoryRoot: string,
  records: readonly { file: string; markdown: string }[],
): string[] {
  return records
    .filter((record) => !hasClosedRecordBanner(record.markdown))
    .flatMap((record) =>
      findCaptureCitations(record.markdown).flatMap((citation) => {
        const problem = citationProblem(repositoryRoot, citation);
        return problem ? [`acceptance-capture: ${record.file}:${citation.line}: ${problem}`] : [];
      }),
    );
}
