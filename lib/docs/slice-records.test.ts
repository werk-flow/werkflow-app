import { describe, expect, test } from "bun:test";
import { findSliceRecordProblems } from "./slice-records";

const sliceIds = new Set(["P1-00", "P1-00A", "P1-01", "P1-02"]);

describe("one document per slice", () => {
  test("allows the baseline sub-slice, cross-slice plans, and unstarted slices", () => {
    expect(findSliceRecordProblems({
      paths: [
        "plans/phase-1/slices/p1-00-baseline.md",
        "plans/phase-1/slices/p1-00a-storage.md",
        "plans/wave-2-audit.md",
      ],
      sliceIds,
    })).toEqual([]);
  });

  test("rejects a second record even when neither file is named implementation-plan", () => {
    expect(findSliceRecordProblems({
      paths: [
        "plans/phase-1/slices/p1-01-customers.md",
        "plans/phase-1/slices/p1-01-extra-evidence.md",
      ],
      sliceIds,
    })).toEqual([expect.stringContaining("P1-01 has two records")]);
  });

  test("rejects a per-slice file outside the canonical folder", () => {
    expect(findSliceRecordProblems({
      paths: ["plans/p1-01-customers.md"], sliceIds,
    })).toEqual([expect.stringContaining("outside plans/phase-1/slices/")]);
  });

  test("rejects a separate implementation-plan inside the folder", () => {
    expect(findSliceRecordProblems({
      paths: ["plans/phase-1/slices/p1-01-implementation-plan.md"], sliceIds,
    })).toEqual([expect.stringContaining("only plan")]);
  });

  test("rejects unknown slice IDs and unowned files hidden by the index folder row", () => {
    expect(findSliceRecordProblems({
      paths: ["plans/phase-1/slices/p1-99-extra.md", "plans/phase-1/slices/notes.md"],
      sliceIds,
    })).toEqual([
      expect.stringContaining("does not name a slice"),
      expect.stringContaining("does not name a slice"),
    ]);
  });
});
