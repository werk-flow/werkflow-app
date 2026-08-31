import { describe, expect, test } from "bun:test";

import type { DocumentUploadTarget } from "./types";

describe("document upload targets", () => {
  test("requires the identifier owned by the selected target kind", () => {
    const serviceCaseTarget = {
      kind: "service_case",
      serviceCaseId: "00000000-0000-4000-8000-000000000001",
    } satisfies DocumentUploadTarget;

    // @ts-expect-error A service-case upload without its owner id must not compile.
    const missingOwner: DocumentUploadTarget = { kind: "service_case" };

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

  test("keeps a maintenance upload on its exact coverage owner", () => {
    const target = {
      kind: "maintenance_coverage",
      maintenanceCoverageId: "00000000-0000-4000-8000-000000000002",
    } satisfies DocumentUploadTarget;

    expect(target.kind).toBe("maintenance_coverage");
    expect(target.maintenanceCoverageId).toBe(
      "00000000-0000-4000-8000-000000000002",
    );

    // @ts-expect-error A maintenance-coverage target requires its exact owner id.
    const missingCoverageOwner: DocumentUploadTarget = {
      kind: "maintenance_coverage",
    };

    const mixedMaintenanceOwner = {
      kind: "maintenance_coverage",
      maintenanceCoverageId: "00000000-0000-4000-8000-000000000002",
      // @ts-expect-error A maintenance target cannot carry a service-case owner.
      serviceCaseId: "00000000-0000-4000-8000-000000000001",
    } satisfies DocumentUploadTarget;

    void missingCoverageOwner;
    void mixedMaintenanceOwner;
  });
});
