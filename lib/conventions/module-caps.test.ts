import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tier 2 for the "capped legacy modules only shrink" rule (AGENTS.md
// "Language And Coding Standards"; pre-Wave-3 step 4 tier audit T1 found 105
// lines of headroom under one cap). Each cap in eslint.config.mjs must equal
// its file's current line count: a shrink that leaves the old cap in place
// fails here, so the cap is lowered in the same change and the headroom for a
// later addition never exists.

const repositoryRoot = resolve(import.meta.dir, "../..");

function lineCount(relativePath: string): number {
  const lines = readFileSync(resolve(repositoryRoot, relativePath), "utf8").split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function readCaps(): Record<string, number> {
  const config = readFileSync(resolve(repositoryRoot, "eslint.config.mjs"), "utf8");
  const block = /\.\.\.Object\.entries\(\{([\s\S]*?)\}\)\.map\(/.exec(config);
  if (!block?.[1]) throw new Error("the capped-module block was not found in eslint.config.mjs");
  const caps: Record<string, number> = {};
  for (const match of block[1].matchAll(/"([^"]+)":\s*(\d+)/g)) {
    const [, file, max] = match;
    if (file && max) caps[file] = Number(max);
  }
  if (Object.keys(caps).length !== 5) throw new Error(`expected five capped modules, found ${Object.keys(caps).length}`);
  return caps;
}

test("every capped legacy module's cap equals its current line count", () => {
  const mismatches = Object.entries(readCaps())
    .map(([file, max]) => ({ file, max, lines: lineCount(file) }))
    .filter(({ max, lines }) => max !== lines);
  expect(mismatches).toEqual([]);
});
