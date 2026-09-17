import { describe, expect, test } from "bun:test";

import type { EffectiveResponsibilityHolder } from "@/lib/responsibilities/resolution";

import {
  loadPendingCorrectionProjection,
  PENDING_CORRECTION_LIMIT,
  type PendingProjectionPort,
  type PendingRequestRow,
  type RevisionRow,
  type SourceRow,
} from "./pending-projection";

const snapshot = { schemaVersion: 1 as const, facts: [] };

function request(id: string, subject: string, requestedBy = subject): PendingRequestRow {
  return {
    id,
    kind: "add",
    status: "submitted",
    subject_user_id: subject,
    requested_by: requestedBy,
    current_revision: 2,
    updated_at: "2026-09-08T08:00:00.000Z",
  };
}

function fakePort(rows: PendingRequestRow[], roles: Array<{ user_id: string; role: string }> = []) {
  const calls: string[] = [];
  const revisions: RevisionRow[] = rows.flatMap((row) => [
    { request_id: row.id, revision: 1, proposed_snapshot: { schemaVersion: 1, facts: [{ old: true }] } },
    { request_id: row.id, revision: row.current_revision, proposed_snapshot: snapshot },
  ]);
  const sources: SourceRow[] = rows.map((row) => ({
    correction_application_id: null,
    ordinal: 0,
    organization_id: "org",
    request_id: row.id,
    revision: row.current_revision,
    source_kind: "legacy_entry",
    source_version: "1",
    time_entry_id: `entry-${row.id}`,
    time_segment_id: null,
    time_session_id: null,
  }));
  const port: PendingProjectionPort = {
    listPendingRequests: async (input) => {
      calls.push(`requests:${input.subjectUserId ?? "*"}:${input.limit}`);
      // The port itself pushes the pending filter down; the fake models that contract.
      return rows.filter((row) => !input.subjectUserId || row.subject_user_id === input.subjectUserId);
    },
    listMemberRoles: async (input) => {
      calls.push(`roles:${input.userIds.length}`);
      return roles;
    },
    listCurrentRevisions: async (input) => {
      calls.push(`revisions:${input.requests.length}`);
      const wanted = new Set(input.requests.map((entry) => `${entry.id}:${entry.currentRevision}`));
      return revisions.filter((revision) => wanted.has(`${revision.request_id}:${revision.revision}`));
    },
    listSources: async (input) => {
      calls.push(`sources:${input.requestIds.length}`);
      return sources.filter((source) => input.requestIds.includes(source.request_id));
    },
  };
  return { port, calls };
}

describe("pending correction projection (PF-19)", () => {
  test("a manager read uses three logical reads with only current revisions", async () => {
    const { port, calls } = fakePort([request("r1", "emil"), request("r2", "nora")]);
    const result = await loadPendingCorrectionProjection(port, {
      organizationId: "org",
      caller: { userId: "greta", role: "admin", holder: null },
    });
    expect(calls).toEqual([`requests:*:${PENDING_CORRECTION_LIMIT}`, "revisions:2", "sources:2"]);
    expect(result?.requests.map((entry) => entry.id)).toEqual(["r1", "r2"]);
    expect(result?.requests[0]?.proposedSnapshot).toEqual(snapshot);
    expect(result?.sources).toHaveLength(2);
  });

  test("an employee subject filter is pushed into the request query", async () => {
    const { port, calls } = fakePort([request("r1", "emil"), request("r2", "nora")]);
    const result = await loadPendingCorrectionProjection(port, {
      organizationId: "org",
      subjectUserId: "emil",
      caller: { userId: "emil", role: "employee", holder: null },
    });
    expect(calls[0]).toBe(`requests:emil:${PENDING_CORRECTION_LIMIT}`);
    expect(result?.requests.map((entry) => entry.id)).toEqual(["r1"]);
    expect(calls.some((call) => call.startsWith("roles"))).toBe(false);
  });

  test("an employee cannot project another subject without reviewer authority", async () => {
    const { port, calls } = fakePort([request("r2", "nora")]);
    const result = await loadPendingCorrectionProjection(port, {
      organizationId: "org",
      subjectUserId: "nora",
      caller: { userId: "emil", role: "employee", holder: null },
    });
    expect(result).toEqual({ requests: [], sources: [] });
    expect(calls).toEqual([]);
  });

  test("an employee holder sees own requests plus the ones they may review", async () => {
    const holder: EffectiveResponsibilityHolder = {
      employeeRecordId: "rec-emil",
      userId: "emil",
      source: { kind: "direct_assignment", configurationId: "c1", assignmentId: "a1" },
    };
    const { port, calls } = fakePort(
      [request("own", "emil"), request("reviewable", "nora"), request("manager", "greta")],
      [{ user_id: "nora", role: "employee" }, { user_id: "greta", role: "admin" }],
    );
    const result = await loadPendingCorrectionProjection(port, {
      organizationId: "org",
      caller: { userId: "emil", role: "employee", holder },
    });
    expect(calls).toEqual([`requests:*:${PENDING_CORRECTION_LIMIT}`, "roles:2", "revisions:3", "sources:3"]);
    // A direct assignment may review anyone except the holder; the role read is still one query.
    expect(result?.requests.map((entry) => entry.id)).toEqual(["own", "reviewable", "manager"]);
  });

  test("a failed read returns null instead of an empty projection", async () => {
    const { port } = fakePort([request("r1", "emil")]);
    port.listSources = async () => null;
    expect(
      await loadPendingCorrectionProjection(port, {
        organizationId: "org",
        caller: { userId: "greta", role: "buero", holder: null },
      }),
    ).toBeNull();
  });

  test("a missing current revision fails instead of silently omitting the pending request", async () => {
    const { port } = fakePort([request("r1", "emil")]);
    port.listCurrentRevisions = async () => [];
    expect(await loadPendingCorrectionProjection(port, {
      organizationId: "org", caller: { userId: "greta", role: "buero", holder: null },
    })).toBeNull();
  });
});
