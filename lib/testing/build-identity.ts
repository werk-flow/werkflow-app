import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const receiptSchema = z.object({
  version: z.literal(1),
  repositoryRoot: z.string(),
  buildId: z.string().min(1),
  sourceDigest: z.string(),
  environmentDigest: z.string(),
  completedAt: z.string(),
});
export type BuildReceipt = z.infer<typeof receiptSchema>;
export type BuildInputs = Pick<BuildReceipt, "sourceDigest" | "environmentDigest">;

// These are the build's source roots, not generated output or agent archives.
const sourceDirectories = ["app", "components", "hooks", "lib", "public", "styles", "types"];
const sourceFiles = [
  "next.config.ts", "next.config.js", "next.config.mjs", "proxy.ts", "middleware.ts",
  "instrumentation.ts", "instrumentation-client.ts", "package.json", "bun.lock",
  "package-lock.json", "tsconfig.json", "postcss.config.mjs", "postcss.config.js",
  "tailwind.config.ts", "tailwind.config.js", "scripts/build.ts",
];

function sourcePaths(root: string): string[] {
  const paths: string[] = [];
  function visit(relative: string): void {
    // These command-only modules are not imported by the application runtime.
    if (relative === 'lib/testing' || relative === 'lib/docs') return;
    const absolute = join(root, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Build identity requires a real source path: ${child}`);
      if (entry.isDirectory()) visit(child);
      else if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(child)) paths.push(child);
    }
  }
  for (const directory of sourceDirectories) visit(directory);
  for (const file of sourceFiles) if (existsSync(join(root, file))) paths.push(file);
  return paths.sort();
}

export function calculateBuildInputs(
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BuildInputs {
  const source = createHash("sha256");
  for (const path of sourcePaths(repositoryRoot)) {
    source.update(path).update("\0").update(readFileSync(join(repositoryRoot, path))).update("\0");
  }
  const settings = createHash("sha256");
  // Hash complete files without storing values. Include Next's production precedence chain.
  for (const filename of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const path = join(repositoryRoot, filename);
    settings.update(filename).update("\0");
    if (existsSync(path)) settings.update(readFileSync(path));
    settings.update("\0");
  }
  for (const key of Object.keys(environment).filter((name) => /^(NEXT_PUBLIC_|SUPABASE_|R2_)/.test(name)).sort()) {
    settings.update(key).update("\0").update(environment[key] ?? "").update("\0");
  }
  return { sourceDigest: source.digest("hex"), environmentDigest: settings.digest("hex") };
}

export function readBuildReceipt(repositoryRoot: string): BuildReceipt {
  const path = resolve(repositoryRoot, ".next/werkflow-build-receipt.json");
  if (!existsSync(path)) throw new Error("Certification requires a recorded build. Run bun run build:test, then restart bun run start.");
  return receiptSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function assertBuildIdentity(input: {
  receipt: BuildReceipt;
  inputs: BuildInputs;
  repositoryRoot: string;
  diskBuildId: string;
  servedBuildId: string | null;
}): void {
  const { receipt, inputs } = input;
  if (realpathSync(input.repositoryRoot) !== receipt.repositoryRoot) throw new Error("Build belongs to another workspace. Rebuild here.");
  if (receipt.buildId !== input.diskBuildId) throw new Error("Build receipt does not match .next/BUILD_ID. Run bun run build:test.");
  if (receipt.sourceDigest !== inputs.sourceDigest) throw new Error("Application source changed after the build. Rebuild and restart before certification.");
  if (receipt.environmentDigest !== inputs.environmentDigest) throw new Error("Build environment changed, including backend routing. Rebuild and restart before certification.");
  if (input.servedBuildId !== receipt.buildId) throw new Error("The served build does not match this workspace's recorded build. Restart bun run start here.");
}
