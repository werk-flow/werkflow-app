import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { TestGroup } from "./test-groups";

const flowId = z.string().regex(/^(?:BASE-[A-Z]+|P1-\d{2}[A-Za-z]?)-F\d{2,3}$/);
const referenceSchema = z.object({
  file: z.string().min(1),
  kind: z.enum(["browser", "unit", "sql", "inspection"]),
  description: z.string().min(1),
}).strict();
export const coverageMapSchema = z.object({
  version: z.literal(1),
  catalogHashes: z.record(flowId, z.string().regex(/^[a-f0-9]{64}$/)),
  mappings: z.array(z.object({
    id: z.string().min(1),
    flowIds: z.array(flowId).min(1),
    evidence: z.array(referenceSchema).min(1),
    clauses: z.string().min(1),
    review: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("imported-ledger"), source: z.string().min(1), row: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("assertions-reviewed"), rationale: z.string().min(1) }).strict(),
    ]),
  }).strict()).min(1),
}).strict();
export type CoverageMap = z.infer<typeof coverageMapSchema>;
export interface CatalogFlow { id: string; bullet: string; hash: string }

export function hashCatalogBullet(bullet: string): string {
  return createHash("sha256").update(bullet.trim().replace(/\s+/g, " ")).digest("hex");
}

export function parseCatalogFlows(content: string): CatalogFlow[] {
  const flows: CatalogFlow[] = [];
  const matches = content.matchAll(/^- `((?:BASE-[A-Z]+|P1-\d{2}[A-Za-z]?)-F\d{2,3})`[^\n]*(?:\n(?!\s*\n|[-#|])[^\n]+)*/gm);
  for (const match of matches) {
    const bullet = match[0].trim();
    flows.push({ id: match[1]!, bullet, hash: hashCatalogBullet(bullet) });
  }
  return flows;
}

export function readCoverageMap(repositoryRoot: string): CoverageMap {
  return coverageMapSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, "lib/testing/coverage-map.json"), "utf8")));
}

function safeRepositoryFile(repositoryRoot: string, file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const path = relative(repositoryRoot, resolve(repositoryRoot, normalized));
  return !isAbsolute(file) && !normalized.split("/").includes("..") && path !== ".." && !path.startsWith(`..\\`) && !path.startsWith("../") && !isAbsolute(path);
}

/** Structural traceability check. Assertion semantics remain an explicit review duty. */
export function validateCoverageMap(input: {
  catalog: readonly CatalogFlow[];
  coverage: CoverageMap;
  groups: readonly TestGroup[];
  repositoryRoot: string;
  fileExists?: (file: string) => boolean;
}): string[] {
  const problems: string[] = [];
  const catalogIds = new Set<string>();
  const mapped = new Set<string>();
  const mappingIds = new Set<string>();
  const files = new Set(input.groups.flatMap((group) => [...group.files]));
  const fileExists = input.fileExists ?? ((file: string): boolean => existsSync(resolve(input.repositoryRoot, file)));
  for (const flow of input.catalog) {
    if (catalogIds.has(flow.id)) problems.push(`Duplicate catalog ID: ${flow.id}`);
    catalogIds.add(flow.id);
    if (input.coverage.catalogHashes[flow.id] !== flow.hash) problems.push(`Catalog behavior changed or is unreviewed: ${flow.id}. Reconcile the whole bullet with its assertions before updating its hash.`);
  }
  for (const id of Object.keys(input.coverage.catalogHashes)) if (!catalogIds.has(id)) problems.push(`Retired or unknown catalog hash: ${id}`);
  for (const mapping of input.coverage.mappings) {
    if (mappingIds.has(mapping.id)) problems.push(`Duplicate coverage mapping: ${mapping.id}`);
    mappingIds.add(mapping.id);
    for (const id of mapping.flowIds) {
      mapped.add(id);
      if (!catalogIds.has(id)) problems.push(`Unknown flow ${id} in ${mapping.id}`);
    }
    if (!mapping.evidence.some((reference) => reference.kind !== "inspection")) problems.push(`No executable evidence in ${mapping.id}; inspection alone cannot cover a user flow.`);
    for (const reference of mapping.evidence) {
      if (!safeRepositoryFile(input.repositoryRoot, reference.file) || !fileExists(reference.file)) problems.push(`Missing or unsafe evidence file in ${mapping.id}: ${reference.file}`);
      if (reference.kind !== "inspection" && !files.has(reference.file)) problems.push(`Evidence file has no executable test group: ${reference.file}`);
      const validKind = reference.kind === "inspection" ||
        (reference.kind === "sql" && reference.file.endsWith(".sql")) ||
        (reference.kind === "unit" && /\.test\.(?:ts|tsx|mjs)$/.test(reference.file)) ||
        (reference.kind === "browser" && reference.file.endsWith(".spec.ts"));
      if (!validKind) problems.push(`Evidence kind disagrees with file: ${reference.file}`);
    }
    if (mapping.review.kind === "imported-ledger" && (!safeRepositoryFile(input.repositoryRoot, mapping.review.source) || !fileExists(mapping.review.source))) problems.push(`Missing imported evidence source: ${mapping.review.source}`);
  }
  for (const id of catalogIds) if (!mapped.has(id)) problems.push(`Unmapped catalog flow: ${id}`);
  return problems;
}
