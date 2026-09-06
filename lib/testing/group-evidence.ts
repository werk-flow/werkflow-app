import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const inputSnapshotSchema = z.object({
  version: z.literal(1),
  files: z.record(z.string(), digestSchema),
  environment: digestSchema,
});
export type InputSnapshot = z.infer<typeof inputSnapshotSchema>;
export type EvidenceGroup = {
  id: string;
  files: readonly string[];
  sourcePrefixes: readonly string[];
};

export function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Runtime Markdown/MDX remains an input; guidance and isolated research are exempt. */
export function isDocumentationInput(file: string): boolean {
  return file.startsWith("docs/") && /\.(md|mdx)$/.test(file) ||
    /^(AGENTS|CLAUDE|README)\.md$/i.test(file) || file.startsWith(".claude/") || file.startsWith(".agents/") ||
    file.startsWith("temporary-transcripts/");
}

/** Includes additions and deletions through snapshot comparison, without recording secret values. */
export function captureInputSnapshot(repositoryRoot: string, environmentDigest: string): InputSnapshot {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const files: Record<string, string> = {};
  for (const file of [...new Set(listed.split("\0"))].sort()) {
    if (!file || !existsSync(resolve(repositoryRoot, file))) continue;
    // Historical prose cannot invalidate behavior proof. Current coverage is checked separately.
    if (isDocumentationInput(file)) continue;
    files[file] = createHash("sha256").update(readFileSync(resolve(repositoryRoot, file))).digest("hex");
  }
  return inputSnapshotSchema.parse({ version: 1, files, environment: environmentDigest });
}

export function changedInputs(previous: InputSnapshot | undefined, current: InputSnapshot): string[] {
  if (!previous) return Object.keys(current.files);
  const changed = [...new Set([...Object.keys(previous.files), ...Object.keys(current.files)])]
    .filter((file) => previous.files[file] !== current.files[file]).sort();
  if (previous.environment !== current.environment) changed.push("<environment>");
  return changed;
}

function isWithin(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/** An unresolved local or computed import requires all repository inputs. */
export const UNKNOWN_IMPORT_DEPENDENCY = "<unknown-import-dependency>";

/** Static package imports are qualified through the globally selected lockfile. */
export function sourceImportGraph(repositoryRoot: string, files: readonly string[]): Map<string, string[]> {
  const available = new Set(files);
  const graph = new Map<string, string[]>();
  const configPath = resolve(repositoryRoot, "tsconfig.json");
  const configSchema = z.object({
    extends: z.unknown().optional(),
    compilerOptions: z.object({
      baseUrl: z.string().optional(),
      paths: z.record(z.string(), z.array(z.string())).optional(),
    }).optional(),
  });
  const config = existsSync(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined;
  const parsedConfig = configSchema.safeParse(config?.config ?? {});
  // Unsupported resolution can make a bare name a local module. In that case
  // qualify broadly until its actual resolver is implemented and reviewed.
  const unknownBareResolution = Boolean(config?.error || !parsedConfig.success ||
    (parsedConfig.success && (parsedConfig.data.extends !== undefined || parsedConfig.data.compilerOptions?.baseUrl !== undefined)));
  const aliases = parsedConfig.success ? Object.keys(parsedConfig.data.compilerOptions?.paths ?? {}) : [];
  const rootAlias = parsedConfig.success ? parsedConfig.data.compilerOptions?.paths?.["@/*"] : undefined;
  const supportedRootAlias = !config || Boolean(rootAlias?.length === 1 && ["./*", "*"].includes(rootAlias[0]));
  function matchesAlias(name: string): boolean {
    return aliases.some((alias) => {
      const wildcard = alias.indexOf("*");
      return wildcard < 0 ? name === alias : name.startsWith(alias.slice(0, wildcard)) && name.endsWith(alias.slice(wildcard + 1));
    });
  }
  function resolveImport(importer: string, name: string): string | undefined {
    if (!name.startsWith(".") && !name.startsWith("@/")) {
      if (name.startsWith("node:")) return undefined;
      return unknownBareResolution || matchesAlias(name) ? UNKNOWN_IMPORT_DEPENDENCY : undefined;
    }
    if (name.startsWith("@/") && !supportedRootAlias) return UNKNOWN_IMPORT_DEPENDENCY;
    const base = posix.normalize(name.startsWith("@/") ? name.slice(2) : `${dirname(importer).replaceAll("\\", "/")}/${name}`);
    if (base === "temporary-transcripts" || base.startsWith("temporary-transcripts/")) {
      throw new Error(`${importer} imports isolated research input ${name}. Move adopted implementation into its owning application module before using it.`);
    }
    const candidates = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js"].map((suffix) => `${base}${suffix}`)];
    // TypeScript permits an emitted .js/.mjs/.cjs suffix to refer to source.
    if (/\.[cm]?jsx?$/.test(base)) {
      const replacement = base.endsWith(".mjs") ? [".mts"] : base.endsWith(".cjs") ? [".cts"] : [".ts", ".tsx"];
      candidates.push(...replacement.map((suffix) => base.replace(/\.[cm]?jsx?$/, suffix)));
    }
    return candidates.find((candidate) => available.has(candidate)) ?? UNKNOWN_IMPORT_DEPENDENCY;
  }
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || !existsSync(resolve(repositoryRoot, file))) continue;
    const source = ts.createSourceFile(file, readFileSync(resolve(repositoryRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
    const imports = new Set<string>();
    function visit(node: ts.Node): void {
      let argument: ts.Expression | undefined;
      let importSite = false;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        argument = node.moduleSpecifier;
        importSite = true;
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        argument = node.arguments[0];
        importSite = true;
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        argument = node.moduleReference.expression;
        importSite = true;
      }
      if (importSite) {
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
          const dependency = resolveImport(file, argument.text);
          if (dependency) imports.add(dependency);
        } else imports.add(UNKNOWN_IMPORT_DEPENDENCY);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    graph.set(file, [...imports]);
  }
  return graph;
}

export function groupInputFiles(input: {
  group: EvidenceGroup;
  groups: readonly EvidenceGroup[];
  files: readonly string[];
  graph: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const selected = new Set<string>();
  const declared = input.groups.flatMap((group) => [...group.sourcePrefixes, ...group.files]);
  for (const file of input.files) {
    const owned = declared.some((prefix) => isWithin(file, prefix));
    // A new or unowned input is global until somebody declares and reviews its ownership.
    if (!owned || input.group.files.includes(file) || input.group.sourcePrefixes.some((prefix) => isWithin(file, prefix))) selected.add(file);
  }
  // Global entries can import feature-owned code too. Selection is not visitation:
  // an already-selected shared module must still contribute its own dependencies.
  const pending = [...selected];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const dependency of input.graph.get(file) ?? []) {
      if (dependency === UNKNOWN_IMPORT_DEPENDENCY) return [...input.files].sort();
      selected.add(dependency);
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...selected].sort();
}

export function groupFingerprint(group: EvidenceGroup, snapshot: InputSnapshot, files: readonly string[]): string {
  return hashValue({ version: 1, group, environment: snapshot.environment, files: files.map((file) => [file, snapshot.files[file] ?? "deleted"]) });
}

export const groupResultSchema = z.object({
  groupId: z.string().min(1),
  fingerprint: digestSchema,
  status: z.enum(["passed", "failed", "blocked"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  runKey: z.string().nullable(),
  buildId: z.string().nullable(),
  logPath: z.string(),
  reason: z.string().nullable(),
});
export type GroupResult = z.infer<typeof groupResultSchema>;

export function reusableGroupResult(input: { groupId: string; fingerprint: string; results: readonly GroupResult[] }): GroupResult | undefined {
  // A later failure invalidates an older pass for the same inputs. Never cherry-pick a lucky pass.
  const latest = input.results.filter((result) => result.groupId === input.groupId && result.fingerprint === input.fingerprint)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt)).at(-1);
  return latest?.status === "passed" ? latest : undefined;
}

export function groupAttemptProblem(input: { groupId: string; fingerprint: string; results: readonly GroupResult[]; recoveredRunKeys?: readonly string[] }): string | undefined {
  const unique = new Map(input.results.filter((result) => result.groupId === input.groupId && result.fingerprint === input.fingerprint && result.status !== "blocked").map((result) => [`${result.groupId}:${result.startedAt}`, result]));
  const attempts = [...unique.values()].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const latest = attempts.at(-1);
  if (latest?.status === "failed") {
    if (attempts.filter((attempt) => attempt.status === "failed").length === 1 && latest.runKey && input.recoveredRunKeys?.includes(latest.runKey)) return undefined;
    return "The latest attempt failed on unchanged inputs. Diagnose the retained evidence before retrying; a repeat is not a repair. One repaired environment failure may be retried after matching retained diagnosis and cleanup; two failures on the same inputs require resolving the underlying cause.";
  }
  return undefined;
}
