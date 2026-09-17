import { createHash } from "node:crypto";
import ts from "typescript";

/**
 * Content identity of a proof input. A comment cannot change what a test
 * reaches, so TypeScript and JavaScript files are hashed by their token stream
 * with comments and inter-token whitespace removed (2026-09-14: a changed
 * comment in `lib/storage/r2.ts` reran all 40 release groups). Line breaks
 * between tokens stay, because automatic semicolon insertion reads them, and
 * every token keeps its exact text, so a regular expression, template literal
 * or JSX text edit still changes the digest. Directives (`'use client'`) are
 * statements, not comments. Lint and type pragmas live in comments; the
 * static lint and typecheck groups always execute, so they cannot hide there.
 */
const CODE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/;

const digestsByRawContent = new Map<string, string>();

function isJsDoc(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/** Token texts joined by a space or, where the source had a line break in between, a newline. */
export function normalizedCode(file: string, source: string): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const parts: string[] = [];
  function visit(node: ts.Node): void {
    if (isJsDoc(node)) return;
    const children = node.getChildren(sourceFile);
    if (children.length) {
      for (const child of children) visit(child);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    // JSX text keeps its surrounding whitespace: it is part of the rendered text.
    const start = node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(sourceFile);
    if (node.end <= start) return;
    parts.push(LINE_BREAK_PATTERN.test(source.slice(node.pos, start)) ? "\n" : " ", source.slice(start, node.end));
  }
  visit(sourceFile);
  return parts.join("");
}

function isCodeFile(file: string): boolean {
  return CODE_FILE_PATTERN.test(file);
}

/** Raw bytes for every other file type; the cache keeps a release run's repeated snapshots cheap. */
export function contentDigest(file: string, contents: Buffer): string {
  const raw = createHash("sha256").update(contents).digest("hex");
  if (!isCodeFile(file)) return raw;
  const cached = digestsByRawContent.get(raw);
  if (cached) return cached;
  const digest = createHash("sha256").update(normalizedCode(file, contents.toString("utf8"))).digest("hex");
  digestsByRawContent.set(raw, digest);
  return digest;
}
