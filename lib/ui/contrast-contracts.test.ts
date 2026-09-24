import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ts from "typescript";

// Tier 2: actual theme tokens and shared control classes must preserve normal
// text contrast. Rendered cascade and caller-specific surfaces remain browser work.
const root = join(import.meta.dir, "..", "..");
const stylesheet = readFileSync(join(root, "app/globals.css"), "utf8");
type Color = readonly [number, number, number];
type Theme = Record<string, string>;

function parseTheme(source: string): Theme {
  return Object.fromEntries(
    [...source.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(
      ([, name, value]) => [name, value],
    ),
  );
}

function readThemePalettes(source: string): { light: Theme; dark: Theme } {
  const light = parseTheme(source.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "");
  const overrides = parseTheme(source.match(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]+)\}/,
  )?.[1] ?? "");
  if (!Object.keys(light).length) throw new Error("Missing light theme tokens.");
  if (!Object.entries(overrides).some(([name, value]) => value !== light[name])) {
    throw new Error("Missing distinct dark theme tokens; refusing to test the light palette twice.");
  }
  return { light, dark: { ...light, ...overrides } };
}

const { light, dark } = readThemePalettes(stylesheet);

test("theme discovery rejects missing, empty and identical dark palettes", () => {
  for (const darkSource of ["", "@media (prefers-color-scheme: dark) { :root {} }",
    "@media (prefers-color-scheme: dark) { :root { --background: #ffffff; } }"]) {
    expect(() => readThemePalettes(`:root { --background: #ffffff; } ${darkSource}`)).toThrow("Missing distinct dark theme tokens");
  }
});

function color(hex: string | undefined): Color {
  if (hex === undefined || !/^#[\da-f]{6}$/i.test(hex))
    throw new Error(`Expected opaque sRGB token: ${hex}`);
  const channel = (offset: number): number =>
    parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

function composite(foreground: Color, background: Color, alpha: number): Color {
  const channel = (index: 0 | 1 | 2): number =>
    foreground[index] * alpha + background[index] * (1 - alpha);
  return [channel(0), channel(1), channel(2)];
}

function luminance(value: Color): number {
  const linear = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return linear(value[0]) * 0.2126 + linear(value[1]) * 0.7152 + linear(value[2]) * 0.0722;
}

function contrast(foreground: Color, background: Color): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function assertReadable(foreground: Color, background: Color): void {
  // Compare before rounding; 4.499 is a failure, not 4.5.
  expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s semantic text contrast", (mode, theme) => {
  test("body, popup, muted, secondary and selected text use readable pairs", () => {
    for (const [foreground, background] of [
      ["foreground", "background"],
      ["card-foreground", "card"],
      ["popover-foreground", "popover"],
      ["muted-foreground", "muted"],
      ["accent-foreground", "accent"],
      ["secondary-foreground", "secondary"],
      ["selection-foreground", "selection"],
    ] as const)
      assertReadable(color(theme[foreground]), color(theme[background]));
  });

  test("calendar surfaces keep their text readable: planning, note, absence, holiday, gutter, off day, today", () => {
    for (const [foreground, background] of [
      ["calendar-planning-foreground", "calendar-planning"],
      ["calendar-note-foreground", "calendar-note"],
      ["calendar-absence-foreground", "calendar-absence"],
      ["calendar-absence-foreground", "calendar-cell-off"],
      ["calendar-holiday-foreground", "calendar-holiday"],
      ["calendar-holiday-foreground", "calendar-cell-off"],
      ["muted-foreground", "calendar-gutter"],
      ["muted-foreground", "calendar-cell-off"],
      ["foreground", "calendar-today"],
      ["muted-foreground", "calendar-today"],
    ] as const)
      assertReadable(color(theme[foreground]), color(theme[background]));
    // The today marker and the board's linked-card ring carry white text on the strong planning tone.
    assertReadable(color(theme["calendar-planning-strong-foreground"]), color(theme["calendar-planning-strong"]));
  });

  test("primary and destructive controls remain readable in every shared state", () => {
    for (const surface of ["background", "card", "muted", "accent"]) {
      for (const alpha of [1, 0.9, 0.8]) {
        assertReadable(
          color(theme["primary-foreground"]),
          composite(color(theme.primary), color(theme[surface]), alpha),
        );
      }
      for (const background of [
        "destructive",
        "destructive-hover",
        "destructive-active",
      ]) {
        assertReadable(
          color(theme["destructive-foreground"]),
          color(theme[background]),
        );
      }
    }
  });

  test("readable orange text survives links and existing selected/count tints", () => {
    for (const surface of ["background", "card", "muted", "accent"]) {
      for (const foreground of [
        "primary-text",
        "primary-text-hover",
        "primary-text-active",
      ]) {
        for (const alpha of [0, 0.1, 0.15]) {
          assertReadable(
            color(theme[foreground]),
            composite(color(theme.primary), color(theme[surface]), alpha),
          );
        }
      }
    }
    // The filter counter deliberately reverses the filled primary pair.
    assertReadable(color(theme.primary), color(theme["primary-foreground"]));
  });

  test("status families read on their fills, their tints and the neutral surfaces", () => {
    for (const family of ["success", "warning", "info"]) {
      assertReadable(color(theme[`${family}-foreground`]), color(theme[family]));
      assertReadable(color(theme[`${family}-soft-foreground`]), color(theme[`${family}-soft`]));
      for (const surface of ["background", "card", "muted", "accent"]) {
        assertReadable(color(theme[`${family}-text`]), color(theme[surface]));
      }
    }
    assertReadable(color(theme["destructive-soft-foreground"]), color(theme["destructive-soft"]));
  });

  test("error text survives current tinted surfaces and destructive menu focus", () => {
    for (const surface of ["background", "card", "muted", "accent"]) {
      for (const alpha of [0, 0.05, 0.1]) {
        assertReadable(
          color(theme.destructive),
          composite(color(theme.destructive), color(theme[surface]), alpha),
        );
      }
    }
    // Dark destructive menu focus is 20% on popover, not arbitrary surfaces.
    assertReadable(
      color(theme.destructive),
      composite(
        color(theme.destructive),
        color(theme.popover),
        mode === "dark" ? 0.2 : 0.1,
      ),
    );
  });
});

test("shared variants consume the measured semantic states", () => {
  const primary = buttonVariants({ variant: "default" });
  for (const token of [
    "bg-primary",
    "text-primary-foreground",
    "hover:bg-primary/90",
    "active:bg-primary/80",
  ])
    expect(primary.split(" ")).toContain(token);
  const destructive = buttonVariants({ variant: "destructive" });
  const destructiveBadge = renderToStaticMarkup(
    createElement(Badge, { variant: "destructive" }, "Fehler"),
  );
  for (const token of [
    "bg-destructive",
    "text-destructive-foreground",
    "hover:bg-destructive-hover",
    "active:bg-destructive-active",
  ]) {
    expect(destructive.split(" ")).toContain(token);
    expect(destructiveBadge).toContain(token);
  }
  for (const token of [
    "text-primary-text",
    "hover:text-primary-text-hover",
    "active:text-primary-text-active",
  ]) {
    expect(buttonVariants({ variant: "link" }).split(" ")).toContain(token);
    expect(
      renderToStaticMarkup(createElement(Badge, { variant: "link" }, "Öffnen")),
    ).toContain(token);
  }
  for (const name of [
    "primary-text",
    "primary-text-hover",
    "primary-text-active",
    "destructive-hover",
    "destructive-active",
  ]) {
    expect(stylesheet).toContain(`--color-${name}: var(--${name});`);
  }
  expect(destructive).not.toContain("text-white");
  expect(destructive).not.toContain("dark:bg-destructive/");
});

test("known pre-repair primary and destructive pairs fail normal-text contrast", () => {
  const white = color("#ffffff");
  expect(contrast(white, color("#ff7900"))).toBeLessThan(4.5);
  expect(contrast(color("#ff7900"), color("#fefcfa"))).toBeLessThan(4.5);
  expect(contrast(white, composite(color("#dc2626"), white, 0.8))).toBeLessThan(
    4.5,
  );
  expect(contrast(color("#fef2f2"), color("#dc2626"))).toBeLessThan(4.5);
  expect(
    contrast(white, composite(color("#f87171"), color("#13121a"), 0.9)),
  ).toBeLessThan(4.5);
});

function mayContainBrightPrimaryText(source: string): boolean {
  // Safe text/foreground tokens share this prefix but cannot match the AST rule.
  // Keep a broad right boundary so variants, opacity, JSX entities and escapes
  // still reach the parser. Every TSX file is read afresh on each census.
  return /text-primary(?![\w-])/.test(source);
}

function brightTextViolations(source: string, fileName: string): number[] {
  if (!mayContainBrightPrimaryText(source)) return [];
  const syntax = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const icons = new Set<string>();
  for (const statement of syntax.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "lucide-react"
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) icons.add(specifier.name.text);
    }
  }
  const violations: number[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && node.name.getText(syntax) === "className") {
      const classes: string[] = [];
      function collect(child: ts.Node): void {
        if (ts.isStringLiteralLike(child)) classes.push(child.text);
        ts.forEachChild(child, collect);
      }
      if (node.initializer) collect(node.initializer);
      const bright = classes.filter((value) =>
        /(?:^|[\s:])text-primary(?=$|[\s/])/.test(value),
      );
      if (bright.length > 0) {
        const opening = node.parent.parent;
        if (
          ts.isJsxOpeningElement(opening) ||
          ts.isJsxSelfClosingElement(opening)
        ) {
          const name = opening.tagName.getText(syntax);
          const iconOnly =
            ts.isJsxOpeningElement(opening) &&
            ts.isJsxElement(opening.parent) &&
            opening.parent.children.some((child) =>
              ts.isJsxSelfClosingElement(child),
            ) &&
            opening.parent.children.every(
              (child) =>
                (ts.isJsxText(child) && child.text.trim() === "") ||
                (ts.isJsxExpression(child) && !child.expression) ||
                (ts.isJsxSelfClosingElement(child) &&
                  icons.has(child.tagName.getText(syntax))),
            );
          const inverse = bright.every((value) =>
            /(?:^|\s)bg-primary-foreground(?:$|\s)/.test(value),
          );
          if (!icons.has(name) && !iconOnly && !inverse)
            violations.push(
              syntax.getLineAndCharacterOfPosition(opening.getStart(syntax))
                .line + 1,
            );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return violations;
}

test("bright primary text is limited to icons and the inverse filled-control pair", () => {
  const violations: string[] = [];
  function inspect(directory: string): void {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) inspect(path);
      else if (entry.name.endsWith(".tsx")) {
        const source = readFileSync(join(root, path), "utf8");
        violations.push(
          ...brightTextViolations(source, path).map(
            (line) => `${path}:${line}`,
          ),
        );
      }
    }
  }
  inspect("app");
  inspect("components");
  expect(violations).toEqual([]);
});

test("bright-text census distinguishes decorative icons from actual labels", () => {
  const source = `import { Search } from 'lucide-react';
    const samples = <>
      <Search className="text-primary" />
      <div className="text-primary"><Search /></div>
      <span className="bg-primary-foreground text-primary">2</span>
      <span className="text-primary-text">Lesbar</span>
      <span className="text-primary">Zu hell</span>
      <span className={active ? 'text-primary' : 'text-muted-foreground'}>Zu hell</span>
      <div className="text-primary"><Search />Suchtext</div>
    </>`;
  expect(brightTextViolations(source, "fixture.tsx")).toHaveLength(3);
});

test("bright-text prefilter skips semantic suffixes without losing variants, opacity or escapes", () => {
  for (const className of ["text-primary-text", "hover:text-primary-text-hover", "text-primary-foreground"]) {
    const source = `<span className="${className}">Lesbar</span>`;
    expect(mayContainBrightPrimaryText(source)).toBe(false);
    expect(brightTextViolations(source, "fixture.tsx")).toEqual([]);
  }
  for (const className of ["text-primary", "hover:text-primary", "text-primary/80", "sm:hover:text-primary/90"]) {
    const source = `<span className="${className}">Zu hell</span>`;
    expect(mayContainBrightPrimaryText(source)).toBe(true);
    expect(brightTextViolations(source, "fixture.tsx")).toHaveLength(1);
  }
  expect(mayContainBrightPrimaryText('<span className="text-primary&#32;font-medium">Text</span>')).toBe(true);
  const escapedWhitespace = String.raw`<span className={'text-primary\u0020font-medium'}>Zu hell</span>`;
  expect(mayContainBrightPrimaryText(escapedWhitespace)).toBe(true);
  expect(brightTextViolations(escapedWhitespace, "fixture.tsx")).toHaveLength(1);
});
