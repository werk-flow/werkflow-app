import { describe, expect, test } from "bun:test";

import { sanitizeDocumentStorageFileName } from "../documents/storage-path";
import {
  getEffectiveAccessState,
  getMembershipAccessMode,
  getOnboardingCompletion,
  toTemplateRpcItems,
} from "./lifecycle";

describe("P1-24 lifecycle projections", () => {
  test("preserves a visible not-configured state when no lifecycle exists", () => {
    expect(getEffectiveAccessState(null)).toBe("not_configured");
  });

  test("applies a due scheduled transition without mutating history", () => {
    expect(
      getEffectiveAccessState(
        {
          state: "active",
          scheduledState: "suspended",
          scheduledFor: "2026-09-03T08:00:00.000Z",
        },
        Date.parse("2026-09-03T08:00:01.000Z"),
      ),
    ).toBe("suspended");
  });

  test("keeps the stored state before a scheduled transition is due", () => {
    expect(
      getEffectiveAccessState(
        {
          state: "scheduled",
          scheduledState: "active",
          scheduledFor: "2026-09-03T08:00:00.000Z",
        },
        Date.parse("2026-09-03T07:59:59.000Z"),
      ),
    ).toBe("scheduled");
  });

  test("resolves organization membership access without trusting stale schedules", () => {
    const dueActivation = {
      hasAccessBlocker: true,
      accessLifecycle: {
        state: "scheduled" as const,
        scheduledState: "active" as const,
        scheduledFor: "2026-09-03T08:00:00.000Z",
      },
    };
    expect(getMembershipAccessMode(dueActivation, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("prestart");
    expect(getMembershipAccessMode({
      hasAccessBlocker: false,
      accessLifecycle: { state: "active", scheduledState: "suspended", scheduledFor: "2026-09-03T08:00:00.000Z" },
    }, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("blocked");
    expect(getMembershipAccessMode({ ...dueActivation, hasAccessBlocker: false }, Date.parse("2026-09-03T07:59:59.000Z"))).toBe("prestart");
    expect(getMembershipAccessMode({
      hasAccessBlocker: false,
      accessLifecycle: { state: "active", scheduledState: "suspended", scheduledFor: "invalid" },
    }, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("operational");
    expect(getMembershipAccessMode({
      hasAccessBlocker: false,
      accessLifecycle: { state: "not_configured", scheduledState: null, scheduledFor: null },
    }, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("blocked");
    expect(getMembershipAccessMode({
      ...dueActivation,
      hasAccessBlocker: false,
    }, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("operational");
    expect(getMembershipAccessMode({
      hasAccessBlocker: true,
      accessLifecycle: { state: "active", scheduledState: null, scheduledFor: null },
    }, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("operational");
    expect(getMembershipAccessMode({
      hasAccessBlocker: true,
      accessLifecycle: null,
    }, Date.parse("2026-09-03T08:00:01.000Z"))).toBe("operational");
  });

  test("treats an optional-only configured plan as ready", () => {
    expect(getOnboardingCompletion([{ isRequired: false, state: "pending" }])).toEqual({
      complete: 0,
      total: 0,
      isReady: true,
    });
  });

  test("does not call an empty plan complete", () => {
    expect(getOnboardingCompletion([])).toEqual({
      complete: 0,
      total: 0,
      isReady: false,
    });
  });

  test("counts waived required items as explicitly resolved", () => {
    expect(
      getOnboardingCompletion([
        { isRequired: true, state: "fulfilled" },
        { isRequired: true, state: "waived" },
        { isRequired: false, state: "missing" },
      ]),
    ).toEqual({ complete: 2, total: 2, isReady: true });
  });

  test("keeps a plan blocked while one required item remains open", () => {
    expect(
      getOnboardingCompletion([
        { isRequired: true, state: "fulfilled" },
        { isRequired: true, state: "pending" },
      ]),
    ).toEqual({ complete: 1, total: 2, isReady: false });
  });

  test("keeps personnel storage names bounded and traversal-free", () => {
    expect(sanitizeDocumentStorageFileName("..")).toBe("document");
    expect(sanitizeDocumentStorageFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeDocumentStorageFileName("")).toBe("document");
    expect(sanitizeDocumentStorageFileName("a".repeat(180))).toHaveLength(140);
    expect(sanitizeDocumentStorageFileName(`${"a".repeat(139)}.ignored`)).toBe(
      "a".repeat(139),
    );
  });

  test("preserves the RPC template-item field contract", () => {
    expect(toTemplateRpcItems([{
      requirementType: "acknowledgement",
      title: "Betriebsregeln bestätigen",
      description: null,
      isRequired: true,
      blocksAccess: true,
      dueOffsetDays: null,
    }])).toEqual([{
      requirementType: "acknowledgement",
      title: "Betriebsregeln bestätigen",
      description: null,
      isRequired: true,
      blocksAccess: true,
      dueOffsetDays: null,
    }]);
  });
});
