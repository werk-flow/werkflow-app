import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendIdentity, normalizeEnvironmentValue, parseEnvironmentFile, proofEnvironmentDigest } from "./proof-environment";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function repository(address: string, extra = ""): string {
  const root = mkdtempSync(join(tmpdir(), "werkflow-proof-environment-"));
  directories.push(root);
  mkdirSync(join(root, "supabase"));
  writeFileSync(join(root, "supabase/config.toml"), 'project_id = "werkflow-app"\n');
  writeFileSync(join(root, ".env.local"), [
    `NEXT_PUBLIC_SUPABASE_URL=http://${address}:54321`,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local",
    "SUPABASE_SECRET_KEY=sb_secret_never-print-me",
    "R2_BUCKET_NAME=werkflow-documents-local",
    `R2_ENDPOINT=http://${address}:54321/storage/v1/s3`,
    "# a comment",
    extra,
  ].join("\n"));
  return root;
}

test("a WSL address change keeps the proof environment digest and the backend identity", () => {
  const before = repository("172.19.150.82");
  const after = repository("172.19.155.11");
  expect(proofEnvironmentDigest(after, {})).toBe(proofEnvironmentDigest(before, {}));
  expect(backendIdentity("http://172.19.150.82:54321", before)).toBe("local:werkflow-app");
  expect(backendIdentity("http://172.19.155.11:54321", after)).toBe("local:werkflow-app");
  expect(backendIdentity("http://localhost:54321", after)).toBe("local:werkflow-app");
  expect(proofEnvironmentDigest(after, { NEXT_PUBLIC_SUPABASE_URL: "http://10.0.0.7:54321" })).toBe(proofEnvironmentDigest(before, { NEXT_PUBLIC_SUPABASE_URL: "http://172.19.150.82:54321" }));
});

test("a different backend, bucket, key or added variable changes the digest without revealing values", () => {
  const local = repository("172.19.150.82");
  const digest = proofEnvironmentDigest(local, {});
  expect(digest).not.toContain("never-print-me");
  const cloud = repository("172.19.150.82");
  writeFileSync(join(cloud, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=https://mbkkzuqjbdvzelqvuzcn.supabase.co\nR2_BUCKET_NAME=werkflow-documents-dev");
  expect(proofEnvironmentDigest(cloud, {})).not.toBe(digest);
  expect(backendIdentity("https://mbkkzuqjbdvzelqvuzcn.supabase.co", cloud)).toBe("mbkkzuqjbdvzelqvuzcn");
  expect(proofEnvironmentDigest(repository("172.19.150.82", "R2_BUCKET_NAME=werkflow-documents-dev"), {})).not.toBe(digest);
  expect(proofEnvironmentDigest(repository("172.19.150.82", "SUPABASE_SECRET_KEY=rotated"), {})).not.toBe(digest);
  expect(proofEnvironmentDigest(repository("172.19.150.82", "NEXT_PUBLIC_NEW_FLAG=1"), {})).not.toBe(digest);
  expect(proofEnvironmentDigest(local, { NEXT_PUBLIC_SUPABASE_URL: "https://different.supabase.co" })).not.toBe(digest);
  expect(proofEnvironmentDigest(local, { UNRELATED_HOST_VARIABLE: "ignored" })).toBe(digest);
});

test("only the private local API origin is replaced; public and non-stack origins stay literal", () => {
  expect(normalizeEnvironmentValue("http://172.19.150.82:54321/storage/v1/s3")).toBe("http://local-supabase-stack:54321/storage/v1/s3");
  expect(normalizeEnvironmentValue("http://192.168.1.4:54321")).toBe("http://local-supabase-stack:54321");
  expect(normalizeEnvironmentValue("https://mbkkzuqjbdvzelqvuzcn.supabase.co")).toBe("https://mbkkzuqjbdvzelqvuzcn.supabase.co");
  expect(normalizeEnvironmentValue("http://172.19.150.82:54324")).toBe("http://172.19.150.82:54324");
  expect(normalizeEnvironmentValue("http://8.8.8.8:54321")).toBe("http://8.8.8.8:54321");
  expect(normalizeEnvironmentValue("https://172.19.150.82:54321")).toBe("https://172.19.150.82:54321");
  expect(backendIdentity("not a url", "/nowhere")).toBe("invalid");
  expect(backendIdentity(undefined, "/nowhere")).toBe("missing");
});

test("the file parser accepts the same lines as the harness env loader", () => {
  expect(parseEnvironmentFile('A=1\n  B = "two"\n# C=3\nbad line\nD=\'four\'')).toEqual({ A: "1", B: "two", D: "four" });
});
