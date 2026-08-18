// Swap .env.local between the dev and live (prod) Supabase/R2 backends.
// Run via: bun run env:dev  |  bun run env:prod
//
// Copies the respective gitignored backup file over .env.local. The backups
// (.env.dev-backup, .env.live-backup) are outside Next.js's env loading chain
// and never committed. See docs/technical/environments.md.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (target !== "dev" && target !== "prod") {
  console.error("Usage: bun scripts/switch-env.ts <dev|prod>");
  process.exit(1);
}

const repoRoot = join(import.meta.dir, "..");
const source = join(repoRoot, target === "dev" ? ".env.dev-backup" : ".env.live-backup");
if (!existsSync(source)) {
  console.error(`Backup file missing: ${source}. Cannot switch.`);
  process.exit(1);
}

copyFileSync(source, join(repoRoot, ".env.local"));

if (target === "prod") {
  console.warn(
    [
      "",
      "############################################################",
      "##  WARNING: .env.local now points at the LIVE PRODUCTION ##",
      "##  Supabase project and the PROD R2 bucket.              ##",
      "##  Real customer data. Do NOT run tests or destructive   ##",
      "##  scripts. Switch back with: bun run env:dev            ##",
      "############################################################",
      "",
    ].join("\n"),
  );
} else {
  console.log(".env.local now points at the DEV backend (mbkkzuqjbdvzelqvuzcn, werkflow-documents-dev).");
}
