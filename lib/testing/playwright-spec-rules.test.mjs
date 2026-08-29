import { describe, expect, test } from "bun:test";
import typescriptParser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import {
  noUnscopedPageSelectorsRule,
  noVisibleTextZeroCountRule,
} from "../../eslint-rules/playwright-spec-rules.mjs";

function lint(source, ruleName, rule) {
  const linter = new Linter();
  return linter.verify(source, [
    {
      languageOptions: {
        parser: typescriptParser,
        parserOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
        },
      },
      plugins: {
        "playwright-spec": {
          rules: { [ruleName]: rule },
        },
      },
      rules: {
        [`playwright-spec/${ruleName}`]: "error",
      },
    },
  ]);
}

describe("Playwright spec ESLint rules", () => {
  test("keeps fixture and popup page aliases covered", () => {
    const messages = lint(
      `
        test("fixture", async ({ adminPage: page }) => {
          const popupPromise = page.waitForEvent("popup");
          await page.getByRole("link").click();
          const popup = await popupPromise;
          const popupAlias = popup;
          return popupAlias.locator("main");
        });
      `,
      "no-unscoped-page-selectors",
      noUnscopedPageSelectorsRule
    );

    expect(messages.map((message) => message.messageId)).toEqual(["locator"]);
  });

  test("rejects raw selectors on Page-typed helper parameters and their aliases", () => {
    const messages = lint(
      `
        import type { Page } from "@playwright/test";
        function customerRow(page: Page) {
          const browserPage = page;
          return browserPage.locator("tr");
        }
      `,
      "no-unscoped-page-selectors",
      noUnscopedPageSelectorsRule
    );

    expect(messages.map((message) => message.messageId)).toEqual(["locator"]);
  });

  test("recognizes aliased and namespace-qualified Playwright Page types", () => {
    const messages = lint(
      `
        import type { Page as BrowserPage } from "@playwright/test";
        import type * as Playwright from "@playwright/test";
        const first = (page: BrowserPage) => page.getByText("Kunde");
        const second = (page: Playwright.Page) => page.locator("main");
      `,
      "no-unscoped-page-selectors",
      noUnscopedPageSelectorsRule
    );

    expect(messages.map((message) => message.messageId)).toEqual(["getByText", "locator"]);
  });

  test("allows selectors scoped from a semantic locator", () => {
    const messages = lint(
      `
        import type { Page } from "@playwright/test";
        function customerRow(page: Page) {
          return page.getByRole("main").locator("tr");
        }
      `,
      "no-unscoped-page-selectors",
      noUnscopedPageSelectorsRule
    );

    expect(messages).toHaveLength(0);
  });

  test("rejects hidden-filtered zero-count assertions, including imported aliases", () => {
    const messages = lint(
      `
        import { visibleText as visible } from "../golden/support/steps";
        expect(visibleText(page, "Secret")).toHaveCount(0);
        expect(visible(page, "Secret alias")).toHaveCount(0);
      `,
      "no-visible-text-zero-count",
      noVisibleTextZeroCountRule
    );

    expect(messages.map((message) => message.messageId)).toEqual([
      "hiddenAbsence",
      "hiddenAbsence",
    ]);
  });

  test("allows DOM-wide zero-count assertions", () => {
    const messages = lint(
      `expect(textInDom(page, "Secret")).toHaveCount(0);`,
      "no-visible-text-zero-count",
      noVisibleTextZeroCountRule
    );

    expect(messages).toHaveLength(0);
  });
});
