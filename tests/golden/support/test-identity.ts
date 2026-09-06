import type { Suite, TestCase } from "@playwright/test/reporter";
import { resolve } from "node:path";
import { browserTestIdentity } from "../../../lib/testing/test-evidence";

export function testIdentity(test: TestCase): string {
  const titles = [test.title];
  for (let parent: Suite | undefined = test.parent; parent; parent = parent.parent) {
    if (parent.type === "describe") titles.unshift(parent.title);
  }
  return browserTestIdentity({ repositoryRoot: resolve(__dirname, "../../.."), file: test.location.file, titles });
}
