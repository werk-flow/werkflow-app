import { describe, expect, test } from "bun:test";

import {
  serviceCaseCreateSchema,
  serviceCaseEvidenceSchema,
  serviceCaseRelationSchema,
  serviceCaseUpdateSchema,
} from "./validation";

const directInput = {
  serviceCaseId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: "00000000-0000-4000-8000-000000000002",
  clientId: "00000000-0000-4000-8000-000000000003",
  siteId: "00000000-0000-4000-8000-000000000004",
  originalStatement: "Die Heizung bleibt kalt.",
  summary: "Heizung ohne Funktion",
  chargeContext: "unknown" as const,
  equipmentIds: [],
};

describe("service case validation", () => {
  test("accepts direct intake with explicit customer statement", () => {
    expect(serviceCaseCreateSchema.safeParse(directInput).success).toBe(true);
  });

  test("accepts request intake without copied customer fields", () => {
    expect(
      serviceCaseCreateSchema.safeParse({
        serviceCaseId: directInput.serviceCaseId,
        idempotencyKey: directInput.idempotencyKey,
        sourceRequestId: "00000000-0000-4000-8000-000000000005",
        chargeContext: "suspected_warranty",
        equipmentIds: [],
      }).success,
    ).toBe(true);
  });

  test("rejects a direct intake without a statement", () => {
    expect(
      serviceCaseCreateSchema.safeParse({
        ...directInput,
        originalStatement: "",
      }).success,
    ).toBe(false);
  });

  const terminalUpdate = {
    serviceCaseId: directInput.serviceCaseId,
    expectedVersion: 1,
    summary: directInput.summary,
    urgency: "normal" as const,
    status: "resolved" as const,
    chargeContext: "unknown" as const,
    equipmentIds: [],
    reason: "Technisch geprüft",
    idempotencyKey: directInput.idempotencyKey,
  };

  test("requires a resolution note for terminal states", () => {
    expect(
      serviceCaseUpdateSchema.safeParse(terminalUpdate).success,
    ).toBe(false);
  });

  test("accepts a terminal state with a resolution note", () => {
    expect(
      serviceCaseUpdateSchema.safeParse({
        ...terminalUpdate,
        resolutionNote: "Anlage geprüft und wieder in Betrieb genommen.",
      }).success,
    ).toBe(true);
  });

  test("rejects text shorter than the database constraints", () => {
    expect(
      serviceCaseCreateSchema.safeParse({
        ...directInput,
        originalStatement: "A",
      }).success,
    ).toBe(false);
    expect(
      serviceCaseCreateSchema.safeParse({
        ...directInput,
        summary: "A",
      }).success,
    ).toBe(false);
    expect(
      serviceCaseUpdateSchema.safeParse({
        ...terminalUpdate,
        resolutionNote: "OK",
      }).success,
    ).toBe(false);
  });

  test("accepts 30 equipment links and rejects 31", () => {
    const equipmentIds = Array.from(
      { length: 31 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    );
    expect(
      serviceCaseCreateSchema.safeParse({
        ...directInput,
        equipmentIds: equipmentIds.slice(0, 30),
      }).success,
    ).toBe(true);
    expect(
      serviceCaseCreateSchema.safeParse({
        ...directInput,
        equipmentIds,
      }).success,
    ).toBe(false);
  });

  test("validates relation and evidence identities", () => {
    expect(
      serviceCaseRelationSchema.safeParse({
        serviceCaseId: directInput.serviceCaseId,
        relatedServiceCaseId: "00000000-0000-4000-8000-000000000006",
        relationType: "related",
        expectedVersion: 1,
        reason: "Gleiche technische Ursache",
        idempotencyKey: directInput.idempotencyKey,
      }).success,
    ).toBe(true);
    expect(
      serviceCaseEvidenceSchema.safeParse({
        serviceCaseId: directInput.serviceCaseId,
        workArtifactRevisionId: "not-a-uuid",
        expectedVersion: 1,
        idempotencyKey: directInput.idempotencyKey,
      }).success,
    ).toBe(false);
  });
});
