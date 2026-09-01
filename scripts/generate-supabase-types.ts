import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { format } from "prettier";

import { getSpawnFailureDetail } from "../lib/testing/spawn-result";

const DEV_PROJECT_ID = "mbkkzuqjbdvzelqvuzcn";
const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
const OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  "lib",
  "supabase",
  "database.types.ts",
);
const CHECK_ONLY = process.argv.slice(2).includes("--check");

const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--check");
if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments.join(", ")}`);
}

const generated = spawnSync(
  process.execPath,
  [
    "x",
    "supabase",
    "gen",
    "types",
    "typescript",
    "--project-id",
    DEV_PROJECT_ID,
    "--schema",
    "graphql_public,public",
  ],
  {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (generated.error || generated.status !== 0) {
  throw new Error(
    `Supabase type generation failed: ${getSpawnFailureDetail(generated, "unknown error")}`,
  );
}

const formatted = await format(generated.stdout, {
  filepath: OUTPUT_PATH,
});

if (!CHECK_ONLY) {
  writeFileSync(OUTPUT_PATH, formatted, "utf8");
  console.log(
    `[types:generate] Wrote DEV types with Supabase 2.116.0 and Prettier 3.6.2.`,
  );
  process.exit(0);
}

const current = readFileSync(OUTPUT_PATH, "utf8");
if (current !== formatted) {
  const digest = (value: string): string =>
    createHash("sha256").update(value).digest("hex").slice(0, 12);
  throw new Error(
    `Generated DEV types differ from the committed file (${digest(current)} != ${digest(formatted)}). Run bun run types:generate and review the schema delta.`,
  );
}

console.log(
  `[types:check] DEV types match Supabase 2.116.0 and Prettier 3.6.2.`,
);
