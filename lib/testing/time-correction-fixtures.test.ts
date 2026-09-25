import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { correctionFixtureArguments } from "../../tests/audit/support/time-correction-fixtures";

describe("canonical correction batch preparation", () => {
  const subject = { organizationId: "organization", employeeRecordId: "person", employeeUserId: "employee", actorUserId: "employee", reason: "Batch preparation" };
  test("resolves protected personnel identity through the scoped server helper, never caller table visibility", () => {
    const file = new URL("../../tests/audit/support/time-correction-fixtures.ts", import.meta.url);
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const serverIdentityCalls: ts.CallExpression[] = [];
    const directPersonnelReads: ts.CallExpression[] = [];
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === "getEmployeeRecordStateByUser") serverIdentityCalls.push(node);
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "from"
          && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "employee_records") directPersonnelReads.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(directPersonnelReads).toHaveLength(0);
    expect(serverIdentityCalls).toHaveLength(1);
    expect(serverIdentityCalls[0]?.arguments.map((argument) => argument.getText(source))).toEqual(["world.orgId", "world.users.employee.id"]);
    expect(source.statements.some((statement) => ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "../../golden/support/db/personnel"
      && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((binding) => binding.name.text === "getEmployeeRecordStateByUser"))).toBe(true);
  });
  test("preserves employee actor and subject with empty prior state and Berlin daylight saving", () => {
    const summer = correctionFixtureArguments({ ...subject, date: "2026-07-08" });
    const winter = correctionFixtureArguments({ ...subject, date: "2026-01-08" });
    expect(summer.p_actor_id).toBe(subject.employeeUserId);
    expect(summer.p_subject_employee_record_id).toBe(subject.employeeRecordId);
    expect(summer.p_before_snapshot).toEqual({ schemaVersion: 1, facts: [] });
    expect(summer.p_sources).toEqual([]);
    expect(summer.p_proposed_snapshot).toMatchObject({ schemaVersion: 1, facts: [
      { employeeRecordId: "person", userId: "employee", entryType: "clock_in", timestamp: "2026-07-08T05:00:00.000Z", isManual: true, jobId: null },
      { employeeRecordId: "person", userId: "employee", entryType: "clock_out", timestamp: "2026-07-08T07:30:00.000Z", isManual: true, jobId: null },
    ] });
    expect(winter.p_proposed_snapshot).toMatchObject({ facts: [{ timestamp: "2026-01-08T06:00:00.000Z" }, { timestamp: "2026-01-08T08:30:00.000Z" }] });
    expect(summer.p_source_scope_key).not.toBe(winter.p_source_scope_key);
    const manager = correctionFixtureArguments({ ...subject, actorUserId: "buero", date: "2026-07-08" });
    expect(manager.p_actor_id).toBe("buero");
    expect(manager.p_subject_employee_record_id).toBe("person");
    expect(manager.p_proposed_snapshot).toMatchObject({ facts: [{ userId: "employee" }, { userId: "employee" }] });
  });
  test("invalid dates fail before any write and separate operations preserve the empty before-state fingerprint", () => {
    expect(() => correctionFixtureArguments({ ...subject, date: "2026-02-30" })).toThrow("exact Berlin date");
    const first = correctionFixtureArguments({ ...subject, date: "2026-07-08" });
    const second = correctionFixtureArguments({ ...subject, date: "2026-07-08" });
    expect(first.p_source_fingerprint).toBe(second.p_source_fingerprint);
    expect(first.p_operation_id).not.toBe(second.p_operation_id);
  });
});
