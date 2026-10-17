import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { TestGroup } from './test-groups';
import { declaredTitles, resolveTitleReference, type DeclaredTitle } from './test-titles';

const flowId = z.string().regex(/^(?:BASE-[A-Z]+|P1-\d{2}[A-Za-z]?)-F\d{2,3}$/);
// Version 2 binds every executable reference to the test titles that prove it.
// A version 1 map named files only; it fails here instead of passing silently.
const COVERAGE_MAP_VERSION = 2;
const referenceSchema = z
  .object({
    file: z.string().min(1),
    kind: z.enum(['browser', 'unit', 'sql', 'inspection']),
    description: z.string().min(1),
    titles: z.array(z.string().min(1)).min(1).optional(),
    unmatched: z.string().min(20).optional(),
  })
  .strict();
export const coverageMapSchema = z
  .object({
    version: z.literal(COVERAGE_MAP_VERSION, {
      error: `Coverage map version must be ${COVERAGE_MAP_VERSION}: every executable reference names its proving test titles.`,
    }),
    catalogHashes: z.record(flowId, z.string().regex(/^[a-f0-9]{64}$/)),
    mappings: z
      .array(
        z
          .object({
            id: z.string().min(1),
            flowIds: z.array(flowId).min(1),
            evidence: z.array(referenceSchema).min(1),
            clauses: z.string().min(1),
            review: z.discriminatedUnion('kind', [
              z
                .object({
                  kind: z.literal('imported-ledger'),
                  source: z.string().min(1),
                  row: z.string().min(1),
                })
                .strict(),
              z.object({ kind: z.literal('assertions-reviewed'), rationale: z.string().min(1) }).strict(),
            ]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CoverageMap = z.infer<typeof coverageMapSchema>;
type CoverageMapping = CoverageMap['mappings'][number];
type EvidenceReference = CoverageMapping['evidence'][number];
export interface CatalogFlow {
  id: string;
  bullet: string;
  hash: string;
}

function hashCatalogBullet(bullet: string): string {
  return createHash('sha256').update(bullet.trim().replace(/\s+/g, ' ')).digest('hex');
}

export function parseCatalogFlows(content: string): CatalogFlow[] {
  const flows: CatalogFlow[] = [];
  const matches = content.matchAll(
    /^- `((?:BASE-[A-Z]+|P1-\d{2}[A-Za-z]?)-F\d{2,3})`[^\n]*(?:\n(?!\s*\n|[-#|])[^\n]+)*/gm,
  );
  for (const match of matches) {
    const [whole, id] = match;
    if (id === undefined) continue;
    const bullet = whole.trim();
    flows.push({ id, bullet, hash: hashCatalogBullet(bullet) });
  }
  return flows;
}

export function readCoverageMap(repositoryRoot: string): CoverageMap {
  return coverageMapSchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, 'lib/testing/selection/coverage-map.json'), 'utf8')),
  );
}

function safeRepositoryFile(repositoryRoot: string, file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  const path = relative(repositoryRoot, resolve(repositoryRoot, normalized));
  return (
    !isAbsolute(file) &&
    !normalized.split('/').includes('..') &&
    path !== '..' &&
    !path.startsWith(`..\\`) &&
    !path.startsWith('../') &&
    !isAbsolute(path)
  );
}

interface ReferenceContext {
  repositoryRoot: string;
  groupFiles: ReadonlySet<string>;
  fileExists: (file: string) => boolean;
  titlesOf: (file: string) => readonly DeclaredTitle[];
}

function kindMatchesFile(reference: EvidenceReference): boolean {
  if (reference.kind === 'inspection') return true;
  if (reference.kind === 'sql') return reference.file.endsWith('.sql');
  if (reference.kind === 'unit') return /\.test\.(?:ts|tsx|mjs)$/.test(reference.file);
  return reference.file.endsWith('.spec.ts');
}

/** Every named title must resolve to exactly one test, describe, step or SQL assertion. */
function titleProblems(mappingId: string, reference: EvidenceReference, context: ReferenceContext): string[] {
  if (reference.titles === undefined) return [];
  const declared = context.titlesOf(reference.file);
  return reference.titles.flatMap((title) => {
    const matches = resolveTitleReference(declared, title).length;
    if (matches === 1) return [];
    return matches === 0
      ? [`Unknown test title in ${mappingId}: "${title}" is not declared in ${reference.file}`]
      : [`Ambiguous test title in ${mappingId}: "${title}" matches ${matches} titles in ${reference.file}`];
  });
}

function referenceProblems(
  mappingId: string,
  reference: EvidenceReference,
  context: ReferenceContext,
): string[] {
  const problems: string[] = [];
  const exists =
    safeRepositoryFile(context.repositoryRoot, reference.file) && context.fileExists(reference.file);
  if (!exists) problems.push(`Missing or unsafe evidence file in ${mappingId}: ${reference.file}`);
  if (reference.kind !== 'inspection' && !context.groupFiles.has(reference.file))
    problems.push(`Evidence file has no executable test group: ${reference.file}`);
  if (!kindMatchesFile(reference)) problems.push(`Evidence kind disagrees with file: ${reference.file}`);
  const named = reference.titles !== undefined;
  const reasoned = reference.unmatched !== undefined;
  if (reference.kind === 'inspection' && (named || reasoned))
    problems.push(`Inspection evidence in ${mappingId} names no test: ${reference.file}`);
  if (reference.kind !== 'inspection' && named === reasoned)
    problems.push(
      `Evidence ${reference.file} in ${mappingId} must name its proving test titles or give the reason none exists, not both.`,
    );
  if (exists && reference.kind !== 'inspection')
    problems.push(...titleProblems(mappingId, reference, context));
  return problems;
}

function mappingProblems(mapping: CoverageMapping, context: ReferenceContext): string[] {
  const problems = mapping.evidence.flatMap((reference) => referenceProblems(mapping.id, reference, context));
  if (
    !mapping.evidence.some((reference) => reference.kind !== 'inspection' && reference.titles !== undefined)
  )
    problems.push(
      `No executable evidence in ${mapping.id}; a mapping needs at least one test title that proves it, and inspection alone cannot cover a user flow.`,
    );
  if (
    mapping.review.kind === 'imported-ledger' &&
    (!safeRepositoryFile(context.repositoryRoot, mapping.review.source) ||
      !context.fileExists(mapping.review.source))
  )
    problems.push(`Missing imported evidence source: ${mapping.review.source}`);
  return problems;
}

function memoizedTitles(repositoryRoot: string): (file: string) => readonly DeclaredTitle[] {
  const cache = new Map<string, readonly DeclaredTitle[]>();
  return (file) => {
    const cached = cache.get(file);
    if (cached !== undefined) return cached;
    const titles = declaredTitles(file, readFileSync(resolve(repositoryRoot, file), 'utf8'));
    cache.set(file, titles);
    return titles;
  };
}

/** Structural traceability check down to test titles. Assertion semantics remain an explicit review duty. */
export function validateCoverageMap(input: {
  catalog: readonly CatalogFlow[];
  coverage: CoverageMap;
  groups: readonly TestGroup[];
  repositoryRoot: string;
  fileExists?: (file: string) => boolean;
  readText?: (file: string) => string;
}): string[] {
  const problems: string[] = [];
  const catalogIds = new Set<string>();
  const mapped = new Set<string>();
  const mappingIds = new Set<string>();
  const readText = input.readText;
  const context: ReferenceContext = {
    repositoryRoot: input.repositoryRoot,
    groupFiles: new Set(input.groups.flatMap((group) => [...group.files])),
    fileExists: input.fileExists ?? ((file) => existsSync(resolve(input.repositoryRoot, file))),
    titlesOf:
      readText === undefined
        ? memoizedTitles(input.repositoryRoot)
        : (file) => declaredTitles(file, readText(file)),
  };
  for (const flow of input.catalog) {
    if (catalogIds.has(flow.id)) problems.push(`Duplicate catalog ID: ${flow.id}`);
    catalogIds.add(flow.id);
    if (input.coverage.catalogHashes[flow.id] !== flow.hash)
      problems.push(
        `Catalog behavior changed or is unreviewed: ${flow.id}. Reconcile the whole bullet with its assertions before updating its hash.`,
      );
  }
  for (const id of Object.keys(input.coverage.catalogHashes))
    if (!catalogIds.has(id)) problems.push(`Retired or unknown catalog hash: ${id}`);
  for (const mapping of input.coverage.mappings) {
    if (mappingIds.has(mapping.id)) problems.push(`Duplicate coverage mapping: ${mapping.id}`);
    mappingIds.add(mapping.id);
    for (const id of mapping.flowIds) {
      mapped.add(id);
      if (!catalogIds.has(id)) problems.push(`Unknown flow ${id} in ${mapping.id}`);
    }
    problems.push(...mappingProblems(mapping, context));
  }
  for (const id of catalogIds) if (!mapped.has(id)) problems.push(`Unmapped catalog flow: ${id}`);
  return problems;
}
