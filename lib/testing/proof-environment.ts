import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Environment identity for proof qualification. The build receipt must hash
 * the raw `.env.local` because the client bundle embeds `NEXT_PUBLIC_*`
 * values; a recorded group pass only needs to know which backend it proved.
 * The WSL stack's private address is transport, not a different database
 * (2026-09-14: one overnight address change discarded all 40 local proofs), so
 * every value is hashed with that origin replaced by a stable token. Keys,
 * bucket names, cloud project origins and unknown variables still count.
 */

/** Next's production precedence chain, the same files the build receipt hashes. */
const ENVIRONMENT_FILES = [".env", ".env.local", ".env.production", ".env.production.local"] as const;
const APPLICATION_ENVIRONMENT_PATTERN = /^(NEXT_PUBLIC_|SUPABASE_|R2_)/;

const LOCAL_API_PORT = "54321";
const PRIVATE_HOST_PATTERN = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const LOCAL_STACK_TOKEN = "http://local-supabase-stack:54321";
const ORIGIN_PATTERN = /https?:\/\/[^\s/"'`]+/g;

function isLocalStackOrigin(value: string | URL): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return url.protocol === "http:" && url.port === LOCAL_API_PORT && PRIVATE_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

/** Replaces the private local-stack origin wherever it appears inside a value. */
export function normalizeEnvironmentValue(value: string): string {
  return value.replace(ORIGIN_PATTERN, (origin) => (isLocalStackOrigin(origin) ? LOCAL_STACK_TOKEN : origin));
}

/** The same line shape `loadEnvLocal` accepts; other lines are comments or blank. */
export function parseEnvironmentFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const [, key, rawValue] = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/) ?? [];
    if (key === undefined || rawValue === undefined) continue;
    values[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

export function proofEnvironmentDigest(
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const digest = createHash("sha256");
  for (const filename of ENVIRONMENT_FILES) {
    const path = join(repositoryRoot, filename);
    digest.update(filename).update("\0");
    if (!existsSync(path)) continue;
    const values = parseEnvironmentFile(readFileSync(path, "utf8"));
    // Code-unit order, the same order the previous key sort produced; the digest must not move.
    const entries = Object.entries(values).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    for (const [key, value] of entries) digest.update(key).update("=").update(normalizeEnvironmentValue(value)).update("\0");
  }
  digest.update("<process>").update("\0");
  for (const key of Object.keys(environment).filter((name) => APPLICATION_ENVIRONMENT_PATTERN.test(name)).sort()) {
    digest.update(key).update("=").update(normalizeEnvironmentValue(environment[key] ?? "")).update("\0");
  }
  return digest.digest("hex");
}

/**
 * Names the backend a run or a cleanup addresses: `local:<project_id>` for the
 * local stack (read from `supabase/config.toml`, the same rule as the
 * performance provider identity), the project ref for a hosted project.
 * Manifests recorded `172` for local runs before 2026-09-14, the first octet
 * of the WSL address.
 */
export function backendIdentity(supabaseUrl: string | undefined, repositoryRoot: string): string {
  if (!supabaseUrl?.trim()) return "missing";
  let url: URL;
  try {
    url = new URL(supabaseUrl.trim());
  } catch {
    return "invalid";
  }
  if (!isLocalStackOrigin(url)) return url.hostname.split(".")[0] || "unknown";
  const configPath = join(repositoryRoot, "supabase/config.toml");
  const projectId = existsSync(configPath) ? readFileSync(configPath, "utf8").match(/^project_id\s*=\s*"([^"]+)"\s*$/m)?.[1] : undefined;
  if (!projectId) throw new Error("The local stack identity needs project_id in supabase/config.toml.");
  return `local:${projectId}`;
}
