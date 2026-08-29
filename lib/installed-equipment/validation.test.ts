import { describe, expect, test } from "bun:test";

import { getAllowedEquipmentTransitions } from "./types";
import {
  equipmentCreateSchema,
  equipmentFormSchema,
  equipmentReplacementSchema,
  equipmentSourceSchema,
  equipmentTransitionSchema,
  equipmentUpdateSchema,
  equipmentWorkLinkSchema,
} from "./validation";

const id = "00000000-0000-4000-8000-000000000001";
const base = {
  clientId: id,
  siteId: "00000000-0000-4000-8000-000000000002",
  name: "Wärmepumpe Wohnhaus",
  category: "heat_generation" as const,
  subtype: "heat_pump" as const,
  state: "unknown" as const,
  identifiers: [],
};

describe("equipmentFormSchema", () => {
  test("keeps unknown technical facts valid", () => {
    expect(equipmentFormSchema.safeParse(base).success).toBe(true);
  });

  test("normalizes empty optional dates to null", () => {
    const result = equipmentFormSchema.safeParse({
      ...base,
      installationDate: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.installationDate).toBeNull();
  });

  test("rejects a subtype from another category", () => {
    const result = equipmentFormSchema.safeParse({
      ...base,
      subtype: "buffer_storage",
    });
    expect(result.success).toBe(false);
  });

  test("requires a parent for a component", () => {
    const result = equipmentFormSchema.safeParse({
      ...base,
      category: "system_component",
      subtype: "pump",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a parent on an equipment root", () => {
    const result = equipmentFormSchema.safeParse({
      ...base,
      parentEquipmentId: id,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a warranty end before its start", () => {
    const result = equipmentFormSchema.safeParse({
      ...base,
      warrantyStartDate: "2026-08-29",
      warrantyEndDate: "2026-08-28",
    });
    expect(result.success).toBe(false);
  });
});

describe("derived equipment form schemas", () => {
  const schemas = [
    {
      name: "create",
      schema: equipmentCreateSchema,
      required: {
        equipmentId: "00000000-0000-4000-8000-000000000010",
        idempotencyKey: "00000000-0000-4000-8000-000000000011",
      },
    },
    {
      name: "update",
      schema: equipmentUpdateSchema,
      required: {
        equipmentId: "00000000-0000-4000-8000-000000000012",
        expectedVersion: 1,
        reason: "Technische Angaben berichtigt",
        idempotencyKey: "00000000-0000-4000-8000-000000000013",
      },
    },
    {
      name: "replacement",
      schema: equipmentReplacementSchema,
      required: {
        predecessorId: "00000000-0000-4000-8000-000000000014",
        successorId: "00000000-0000-4000-8000-000000000015",
        expectedVersion: 1,
        effectiveAt: "2026-08-29T08:00:00+02:00",
        reason: "Defekte Anlage fachgerecht ersetzt",
        idempotencyKey: "00000000-0000-4000-8000-000000000016",
      },
    },
  ] as const;

  for (const { name, schema, required } of schemas) {
    test(`${name} preserves subtype/category validation`, () => {
      expect(
        schema.safeParse({ ...base, ...required, subtype: "buffer_storage" })
          .success,
      ).toBe(false);
    });

    test(`${name} preserves component-parent validation`, () => {
      expect(
        schema.safeParse({
          ...base,
          ...required,
          category: "system_component",
          subtype: "pump",
        }).success,
      ).toBe(false);
    });

    test(`${name} preserves warranty-range validation`, () => {
      expect(
        schema.safeParse({
          ...base,
          ...required,
          warrantyStartDate: "2026-08-29",
          warrantyEndDate: "2026-08-28",
        }).success,
      ).toBe(false);
    });
  }
});

describe("equipment lifecycle validation", () => {
  test("keeps replacement out of the generic transition action", () => {
    expect(getAllowedEquipmentTransitions("active")).not.toContain("replaced");
    expect(getAllowedEquipmentTransitions("replaced")).toEqual([]);
    expect(getAllowedEquipmentTransitions("decommissioned")).toEqual([]);
  });

  test("permits reactivation only for inactive or removed equipment", () => {
    expect(getAllowedEquipmentTransitions("inactive")).toContain("active");
    expect(getAllowedEquipmentTransitions("removed")).toEqual(["active"]);
  });

  const validTransition = {
    equipmentId: id,
    expectedVersion: 1,
    toState: "inactive" as const,
    effectiveAt: "2026-08-29T08:00:00+02:00",
    reason: "Anlage kontrolliert außer Betrieb genommen",
    idempotencyKey: "00000000-0000-4000-8000-000000000004",
  };

  test("accepts a complete transition", () => {
    expect(equipmentTransitionSchema.safeParse(validTransition).success).toBe(
      true,
    );
  });

  test("requires a reason for a transition", () => {
    expect(
      equipmentTransitionSchema.safeParse({ ...validTransition, reason: "" })
        .success,
    ).toBe(false);
  });

  test("requires a UUID idempotency key for a transition", () => {
    expect(
      equipmentTransitionSchema.safeParse({
        ...validTransition,
        idempotencyKey: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  test("requires exact document details only for document sources", () => {
    const source = {
      equipmentId: id,
      expectedVersion: 1,
      targetId: "00000000-0000-4000-8000-000000000005",
      reason: "Exakter Nachweis der Installation",
      idempotencyKey: "00000000-0000-4000-8000-000000000006",
    };
    expect(
      equipmentSourceSchema.safeParse({
        ...source,
        targetType: "document",
        documentVersionNumber: 1,
      }).success,
    ).toBe(true);
    expect(
      equipmentSourceSchema.safeParse({ ...source, targetType: "document" })
        .success,
    ).toBe(false);
    expect(
      equipmentSourceSchema.safeParse({
        ...source,
        targetType: "job",
        documentVersionNumber: 1,
      }).success,
    ).toBe(false);
    expect(
      equipmentSourceSchema.safeParse({ ...source, targetType: "job" }).success,
    ).toBe(true);
  });

  test("requires exactly one job or project target", () => {
    const input = {
      equipmentId: id,
      expectedVersion: 1,
      linked: true,
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
    };
    expect(equipmentWorkLinkSchema.safeParse(input).success).toBe(false);
    expect(
      equipmentWorkLinkSchema.safeParse({ ...input, jobId: id, projectId: id })
        .success,
    ).toBe(false);
    expect(
      equipmentWorkLinkSchema.safeParse({ ...input, jobId: id }).success,
    ).toBe(true);
  });
});
