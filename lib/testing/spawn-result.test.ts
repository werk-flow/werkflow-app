import { describe, expect, test } from "bun:test";

import { getSpawnFailureDetail } from "./spawn-result";

describe("spawn failure diagnostics", () => {
  test("preserves stderr from a failed child process", () => {
    expect(
      getSpawnFailureDetail(
        { status: 1, stderr: "  command failed\n" },
        "fallback",
      ),
    ).toBe("command failed");
  });

  test("reports a process-creation error when stderr is null", () => {
    expect(
      getSpawnFailureDetail(
        {
          error: new Error("Access is denied"),
          status: null,
          stderr: null,
        },
        "fallback",
      ),
    ).toBe("Access is denied");
  });

  test("uses the caller fallback when the host supplies no detail", () => {
    expect(
      getSpawnFailureDetail({ status: null, stderr: null }, "unknown error"),
    ).toBe("unknown error");
  });
});
