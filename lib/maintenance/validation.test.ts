import { describe, expect, test } from "bun:test";

import {
  maintenanceCompletionSchema,
  maintenanceCoverageSchema,
  maintenancePlanSchema,
  maintenanceVisitLinkSchema,
} from "./validation";

const IDENTIFIERS = {
  planId: "11111111-1111-4111-8111-111111111111",
  revisionId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  siteId: "44444444-4444-4444-8444-444444444444",
  templateVersionId: "55555555-5555-4555-8555-555555555555",
  equipmentId: "66666666-6666-4666-8666-666666666666",
  idempotencyKey: "77777777-7777-4777-8777-777777777777",
} as const;

const VALID_PLAN = {
  ...IDENTIFIERS,
  status: "active",
  effectiveFromDate: "2026-09-01",
  firstDueDate: "2026-10-01",
  intervalMonths: 12,
  dueWindowBeforeDays: 14,
  dueWindowAfterDays: 14,
  plannedDurationMinutes: 120,
  nextDueBasis: "planned_due_date",
  reason: "Wartungsplan angelegt",
  equipmentIds: [IDENTIFIERS.equipmentId],
} as const;

describe("maintenance validation boundaries", () => {
  test("accepts one exact site, template version and equipment set", () => {
    expect(maintenancePlanSchema.safeParse(VALID_PLAN).success).toBe(true);
  });

  test("rejects a first due date before the effective date", () => {
    const result = maintenancePlanSchema.safeParse({
      ...VALID_PLAN,
      firstDueDate: "2026-08-31",
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["firstDueDate"]);
  });

  test("rejects an empty equipment scope", () => {
    const result = maintenancePlanSchema.safeParse({
      ...VALID_PLAN,
      equipmentIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["equipmentIds"]);
  });

  test("rejects duplicate equipment identities", () => {
    const result = maintenancePlanSchema.safeParse({
      ...VALID_PLAN,
      equipmentIds: [IDENTIFIERS.equipmentId, IDENTIFIERS.equipmentId],
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["equipmentIds"]);
  });

  test("keeps operational coverage dates bounded and internally consistent", () => {
    expect(
      maintenanceCoverageSchema.safeParse({
        coverageId: IDENTIFIERS.planId,
        clientId: IDENTIFIERS.clientId,
        siteId: IDENTIFIERS.siteId,
        status: "active",
        validFrom: "2027-01-01",
        validUntil: "2026-12-31",
        idempotencyKey: IDENTIFIERS.idempotencyKey,
      }).success,
    ).toBe(false);
  });

  test("requires aligned visit identities and explicit completion evidence", () => {
    expect(
      maintenanceVisitLinkSchema.safeParse({
        dueWorkIds: [IDENTIFIERS.planId],
        expectedVersions: [1],
        jobId: IDENTIFIERS.siteId,
        reason: "Wartungsauftrag verknüpft",
        idempotencyKey: IDENTIFIERS.idempotencyKey,
      }).success,
    ).toBe(true);
    expect(
      maintenanceCompletionSchema.safeParse({
        dueWorkId: IDENTIFIERS.planId,
        expectedVersion: 2,
        scopeOutcome: "complete",
        completedOn: "2026-10-01",
        workArtifactRevisionIds: [],
        reason: "Wartung abgeschlossen",
        idempotencyKey: IDENTIFIERS.idempotencyKey,
      }).success,
    ).toBe(false);
  });

  test("rejects visit batches without one expected version per due item", () => {
    const result = maintenanceVisitLinkSchema.safeParse({
      dueWorkIds: [IDENTIFIERS.planId, IDENTIFIERS.revisionId],
      expectedVersions: [1],
      jobId: IDENTIFIERS.siteId,
      reason: "Wartungsauftrag verknüpft",
      idempotencyKey: IDENTIFIERS.idempotencyKey,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["expectedVersions"]);
    }
  });
});
