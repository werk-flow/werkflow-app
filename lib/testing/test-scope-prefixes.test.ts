import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { TEST_SCOPE_PREFIXES } from "./test-groups";

const repositoryRoot = resolve(import.meta.dir, "../..");

// A scope prefix that names no directory owns nothing, so the code it was meant
// to own is charged to every group instead (lib/customers/ versus lib/clients/,
// found 2026-09-14). A renamed feature folder must update the registry.
test("every test scope prefix is an existing directory", () => {
  const missing = Object.entries(TEST_SCOPE_PREFIXES).flatMap(([scope, prefixes]) =>
    prefixes.filter((prefix) => !prefix.endsWith("/") || !existsSync(resolve(repositoryRoot, prefix)) || !statSync(resolve(repositoryRoot, prefix)).isDirectory()).map((prefix) => `${scope}: ${prefix}`));
  expect(missing).toEqual([]);
});
