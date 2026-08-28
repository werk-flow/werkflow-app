// Swap .env.local between the local-stack, dev, and live (prod) backends.
// Run via: bun run env:local  |  bun run env:dev  |  bun run env:prod
//
// Copies the respective gitignored backup file over .env.local. The backups
// (.env.local-stack-backup, .env.dev-backup, .env.live-backup) are outside
// Next.js's env loading chain and never committed.
//
// The local target additionally refreshes the stack's address: the Supabase
// stack runs in WSL, Windows' localhost relay to WSL drops connections under
// sustained traffic (observed 2026-08-28), so the harness addresses the WSL
// VM's NAT IP directly — and that IP changes whenever WSL restarts. Rerun
// `bun run env:local` after a WSL restart (plus a rebuild before
// certification, because NEXT_PUBLIC_* values are baked into the build).
// See docs/technical/environments.md.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BACKUP_FILES = {
  local: ".env.local-stack-backup",
  dev: ".env.dev-backup",
  prod: ".env.live-backup",
} as const;

const target = process.argv[2] as keyof typeof BACKUP_FILES | undefined;
if (!target || !(target in BACKUP_FILES)) {
  console.error("Usage: bun scripts/switch-env.ts <local|dev|prod>");
  process.exit(1);
}

const repoRoot = join(import.meta.dir, "..");
const source = join(repoRoot, BACKUP_FILES[target]);
if (!existsSync(source)) {
  console.error(`Backup file missing: ${source}. Cannot switch.`);
  process.exit(1);
}

function resolveWslIp(): string {
  let output: string;
  try {
    output = execFileSync("wsl.exe", ["hostname", "-I"], { encoding: "utf8", timeout: 30_000 });
  } catch (error) {
    console.error(
      `Could not resolve the WSL address (${error instanceof Error ? error.message : String(error)}). Is WSL installed and the local stack set up? See docs/technical/environments.md.`,
    );
    process.exit(1);
  }
  const ip = output.trim().split(/\s+/)[0];
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    console.error(`Unexpected WSL address output: ${output.trim()}`);
    process.exit(1);
  }
  return ip;
}

if (target === "local") {
  const ip = resolveWslIp();
  const backupContents = readFileSync(source, "utf8");
  // A missing line would make the replace a silent no-op and leave .env.local
  // half-stale; fail here instead of in a later preflight.
  if (
    !/^NEXT_PUBLIC_SUPABASE_URL=.*$/m.test(backupContents) ||
    !/^R2_ENDPOINT=.*$/m.test(backupContents)
  ) {
    console.error(
      `${BACKUP_FILES.local} must define NEXT_PUBLIC_SUPABASE_URL and R2_ENDPOINT; restore it per docs/technical/environments.md.`,
    );
    process.exit(1);
  }
  const refreshed = backupContents
    .replace(/^NEXT_PUBLIC_SUPABASE_URL=.*$/m, `NEXT_PUBLIC_SUPABASE_URL=http://${ip}:54321`)
    .replace(/^R2_ENDPOINT=.*$/m, `R2_ENDPOINT=http://${ip}:54321/storage/v1/s3`);
  writeFileSync(source, refreshed);
  writeFileSync(join(repoRoot, ".env.local"), refreshed);
  console.log(
    `.env.local now points at the LOCAL Supabase stack (http://${ip}:54321, werkflow-documents-local). Start it with \`wsl supabase start\` if it is not running.`,
  );
} else {
  copyFileSync(source, join(repoRoot, ".env.local"));
}

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
} else if (target === "dev") {
  console.log(".env.local now points at the cloud DEV backend (mbkkzuqjbdvzelqvuzcn, werkflow-documents-dev).");
}
