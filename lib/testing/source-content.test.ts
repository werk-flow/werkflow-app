import { expect, test } from "bun:test";
import { contentDigest, normalizedCode } from "./source-content";

const digest = (file: string, source: string): string => contentDigest(file, Buffer.from(source));

test("comment, JSDoc and indentation edits keep a code file's content identity", () => {
  const original = [
    "/** Reads one row. */",
    "export function read(id: string) {",
    "  // fetch the row",
    "  return load(id); /* trailing */",
    "}",
  ].join("\n");
  const edited = [
    "/** Reads one row after the 2026-09-14 pointer fix (docs/plans/phase-1/audits/golden-gate-log.md). */",
    "export function read(id: string) {",
    "      // a different comment",
    "      return load(id);",
    "}",
    "",
  ].join("\r\n");
  expect(digest("lib/read.ts", edited)).toBe(digest("lib/read.ts", original));
  expect(digest("lib/read.tsx", original)).toBe(digest("lib/read.tsx", original.replaceAll("\n", "\n\n")));
});

test("token text and statement-separating line breaks still change the identity", () => {
  const base = "export const pattern = /a b/; const text = `x  y`; const jsx = <p> hello </p>; function f() { return\nvalue; }";
  expect(digest("a.tsx", base.replace("/a b/", "/ab/"))).not.toBe(digest("a.tsx", base));
  expect(digest("a.tsx", base.replace("`x  y`", "`x y`"))).not.toBe(digest("a.tsx", base));
  expect(digest("a.tsx", base.replace("<p> hello </p>", "<p>hello</p>"))).not.toBe(digest("a.tsx", base));
  expect(digest("a.tsx", base.replace("return\nvalue", "return value"))).not.toBe(digest("a.tsx", base));
  expect(digest("a.tsx", base.replace("return\nvalue", "return /* c\n */ value"))).toBe(digest("a.tsx", base));
  expect(digest("a.ts", "'use client';\nexport const x = 1;")).not.toBe(digest("a.ts", "export const x = 1;"));
  expect(digest("a.ts", "export type A = { a: 1 };")).not.toBe(digest("a.ts", "export type A = { a: 2 };"));
});

test("non-code files keep their raw identity and the normalized form is readable", () => {
  expect(digest("data.json", '{"a": 1}')).not.toBe(digest("data.json", '{"a":  1}'));
  expect(digest("query.sql", "-- comment\nselect 1;")).not.toBe(digest("query.sql", "select 1;"));
  expect(normalizedCode("a.ts", "const a = 1; // one\nconst b = 2;")).toBe(" const a = 1 ;\nconst b = 2 ;");
});
