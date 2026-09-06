import { describe, expect, test } from "bun:test";
import { parseCatalogFlows, validateCoverageMap, coverageMapSchema, type CoverageMap } from "./coverage-map";
import type { TestGroup } from "./test-groups";

const catalog = parseCatalogFlows("- `P1-22-F01` — Employee submits. The manager sees one request.\n\n- `P1-22-F02` — Another company cannot read it.\n");
const groups: TestGroup[] = [{ id: "audit:corrections", files: ["tests/corrections.spec.ts"], kind: "audit", scopes: ["time"], prerequisites: [], isolation: "group-world", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } }];
function mapping(): CoverageMap {
  return {
    version: 1,
    catalogHashes: Object.fromEntries(catalog.map((flow) => [flow.id, flow.hash])),
    mappings: [{
      id: "correction-review", flowIds: catalog.map((flow) => flow.id),
      evidence: [{ file: "tests/corrections.spec.ts", kind: "browser", description: "Submit and exact request cardinality; outsider reads zero rows." }],
      clauses: "The employee submits once. The manager sees exactly one request. Another company sees none.",
      review: { kind: "assertions-reviewed", rationale: "Both visible and saved outcomes are asserted." },
    }],
  };
}
function validate(coverage: CoverageMap): string[] {
  return validateCoverageMap({ catalog, coverage, groups, repositoryRoot: process.cwd(), fileExists: () => true });
}

describe("catalog coverage traceability", () => {
  test("one reviewed mapping can prove several flows without test-count equivalence", () => {
    expect(validate(mapping())).toEqual([]);
  });
  test("changing a second observable clause reopens the whole bullet", () => {
    const changed = parseCatalogFlows("- `P1-22-F01` — Employee submits. The manager sees two requests.\n\n- `P1-22-F02` — Another company cannot read it.\n");
    expect(validateCoverageMap({ catalog: changed, coverage: mapping(), groups, repositoryRoot: process.cwd(), fileExists: () => true }).some((problem) => problem.includes("changed or is unreviewed: P1-22-F01"))).toBe(true);
  });
  test("deleting a mapping, adding an unknown ID, and deleting its executable file fail", () => {
    const missing = mapping();
    missing.mappings[0]!.flowIds = ["P1-22-F01", "P1-22-F99"];
    expect(validate(missing)).toEqual(expect.arrayContaining(["Unmapped catalog flow: P1-22-F02", "Unknown flow P1-22-F99 in correction-review"]));
    expect(validateCoverageMap({ catalog, coverage: mapping(), groups, repositoryRoot: process.cwd(), fileExists: () => false }).some((problem) => problem.includes("Missing or unsafe evidence file"))).toBe(true);
  });
  test("an inspection cannot silently replace executable coverage", () => {
    const onlyInspection = mapping();
    onlyInspection.mappings[0]!.evidence = [{ kind: "inspection", file: "docs/review.md", description: "A reviewer looked at it." }];
    expect(validate(onlyInspection)).toContain("No executable evidence in correction-review; inspection alone cannot cover a user flow.");
  });
  test("unsafe references and unregistered tests fail even when the file exists", () => {
    const unsafe = mapping();
    unsafe.mappings[0]!.evidence[0]!.file = "../other-repo/test.spec.ts";
    expect(validate(unsafe).some((problem) => problem.includes("unsafe evidence"))).toBe(true);
    expect(validate(unsafe).some((problem) => problem.includes("no executable test group"))).toBe(true);
  });
  test("whole bullets, lowercase immutable IDs, and wrapped lines are hashed", () => {
    const flows = parseCatalogFlows("- `P1-00a-F01` — Upload shows progress.\n  Download remains private.\n\n## Next\n");
    expect(flows).toHaveLength(1);
    expect(flows[0]!.id).toBe("P1-00a-F01");
    expect(flows[0]!.bullet).toContain("Download remains private");
    expect(coverageMapSchema.safeParse({ ...mapping(), unnoticed: true }).success).toBe(false);
  });
});
