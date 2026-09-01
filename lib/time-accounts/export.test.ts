import { describe, expect, test } from "bun:test";
import {
  buildPayrollExportPackage,
  distributeCreditedMinutes,
} from "./export";
import type { PayrollExportInput } from "./types";

const input: PayrollExportInput = {
  manifest: {
    schemaVersion: 1,
    exportId: "export-1",
    exportVersion: 1,
    supersedesExportId: null,
    organizationId: "org-1",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    closeVersion: 1,
    mappingVersion: 1,
    generatorVersion: "p1-23-v1",
    generatedAt: "2026-11-01T08:00:00.000Z",
    scope: "organization_period",
  },
  valueRows: [
    {
      rowId: "value-1",
      employeeRecordId: "employee-1",
      externalEmployeeReference: "MA-001",
      localDate: "2026-10-05",
      valueKind: "credited_activity",
      outputCode: "1000",
      sourceSeconds: 3600,
      minutes: 60,
      roundingDeltaSeconds: 0,
      policyVersionId: "policy-version-1",
      calculationVersion: 1,
    },
  ],
  allocationRows: [
    {
      rowId: "allocation-1",
      employeeRecordId: "employee-1",
      externalEmployeeReference: "MA-001",
      localDate: "2026-10-05",
      activityKind: "work",
      sourceReference: "segment-1",
      sourceSeconds: 3600,
      creditedMinutes: 60,
      allocationKind: "job",
      jobNumber: "A-100",
      projectNumber: "",
    },
  ],
  correctionRows: [
    {
      rowId: "correction-1",
      employeeRecordId: "employee-1",
      requestId: "request-1",
      revision: 1,
      applicationId: "application-1",
      sourceFingerprint: "a".repeat(64),
    },
  ],
};

describe("P1-23 payroll export package", () => {
  test("is byte-stable and self-identifying", () => {
    const secondValueRow = {
      ...input.valueRows[0],
      rowId: "value-0",
      minutes: 30,
    };
    const first = buildPayrollExportPackage(input);
    const second = buildPayrollExportPackage({
      ...input,
      valueRows: [secondValueRow, ...input.valueRows].reverse(),
    });
    const ordered = buildPayrollExportPackage({
      ...input,
      valueRows: [secondValueRow, ...input.valueRows],
    });
    expect(first.sha256).toHaveLength(64);
    expect(ordered.sha256).toBe(second.sha256);
    expect(ordered.bytes).toEqual(second.bytes);
    expect(Object.keys(first.files).sort()).toEqual([
      "kontrollsummen.csv",
      "korrekturen.csv",
      "lohnwerte.csv",
      "manifest.json",
      "zuordnungen.csv",
    ]);
    expect(first.files["lohnwerte.csv"].slice(0, 3)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf]),
    );
  });

  test("escapes semicolons and quotes without changing control totals", () => {
    const result = buildPayrollExportPackage({
      ...input,
      valueRows: [{ ...input.valueRows[0], outputCode: 'Code;"Sonder"' }],
    });
    const csv = new TextDecoder().decode(result.files["lohnwerte.csv"]);
    expect(csv).toContain('"Code;""Sonder"""');
    expect(
      new TextDecoder().decode(result.files["kontrollsummen.csv"]),
    ).toContain("1;1;1;3600;60;0");
  });

  test("neutralizes spreadsheet formula prefixes", () => {
    const result = buildPayrollExportPackage({
      ...input,
      valueRows: [{ ...input.valueRows[0], outputCode: "=1+1" }],
    });
    const csv = new TextDecoder().decode(result.files["lohnwerte.csv"]);
    expect(csv).toContain("'=1+1");
  });

  test("preserves negative numeric values and canonicalizes manifest keys", () => {
    const first = buildPayrollExportPackage({
      ...input,
      manifest: { ...input.manifest, schemaVersion: 1 },
      valueRows: [
        { ...input.valueRows[0], sourceSeconds: 3570, roundingDeltaSeconds: -30 },
      ],
    });
    const reversedManifest = Object.fromEntries(
      Object.entries(input.manifest).reverse(),
    ) as PayrollExportInput["manifest"];
    const second = buildPayrollExportPackage({
      ...input,
      manifest: reversedManifest,
      valueRows: [
        { ...input.valueRows[0], sourceSeconds: 3570, roundingDeltaSeconds: -30 },
      ],
    });
    expect(new TextDecoder().decode(first.files["lohnwerte.csv"])).toContain(
      ";-30;",
    );
    expect(first.bytes).toEqual(second.bytes);
  });

  test("distributes rounded allocation minutes without drift", () => {
    const result = distributeCreditedMinutes(
      [
        { id: "b", sourceSeconds: 20 },
        { id: "a", sourceSeconds: 20 },
        { id: "c", sourceSeconds: 20 },
      ],
      2,
    );
    expect([...result.values()].reduce((total, minutes) => total + minutes, 0)).toBe(2);
    expect(result).toEqual(new Map([["a", 1], ["b", 1], ["c", 0]]));
  });
});
