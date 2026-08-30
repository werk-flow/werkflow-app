import { describe, expect, test } from "bun:test";

import type { DocumentUploadTarget } from "./types";

describe("document upload targets", () => {
  test("requires the identifier owned by the selected target kind", () => {
    const serviceCaseTarget = {
      kind: "service_case",
      serviceCaseId: "00000000-0000-4000-8000-000000000001",
    } satisfies DocumentUploadTarget;

    // @ts-expect-error A service-case upload without its owner id must not compile.
    const missingOwner = { kind: "service_case" } satisfies DocumentUploadTarget;

    const mixedOwners = {
      kind: "job",
      jobId: "00000000-0000-4000-8000-000000000002",
      // @ts-expect-error A target cannot carry identifiers from two owner kinds.
      serviceCaseId: "00000000-0000-4000-8000-000000000001",
    } satisfies DocumentUploadTarget;

    expect(serviceCaseTarget.kind).toBe("service_case");
    void missingOwner;
    void mixedOwners;
  });
});
