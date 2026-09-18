import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Status colors are semantic tokens (app/globals.css); the paletteSelectors lint
// bans numbered palette classes in product JSX. A harness assertion on a palette
// class survives that lint and fails only in a browser run, which is how
// A1-24/25 failed the release run of 2026-09-18 after step 2 moved the pending
// block to bg-warning. Expectations name tokens, never Tailwind palette colors.
const PALETTE_CLASS = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|placeholder|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-/;
const root = resolve(import.meta.dir, "../..");

function testFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : testFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("harness files assert semantic tokens, not Tailwind palette classes", () => {
  const offenders = testFiles(resolve(root, "tests")).flatMap((path) =>
    readFileSync(path, "utf8").split(/\r?\n/).flatMap((line, index) =>
      PALETTE_CLASS.test(line) ? [`${relative(root, path).replaceAll("\\", "/")}:${index + 1}: ${line.trim()}`] : []));
  expect(offenders).toEqual([]);
});
