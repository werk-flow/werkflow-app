import type { Page } from "@playwright/test";
import { checkpointValue, saveCheckpoint } from "./support/checkpoints";

import { expect, test } from "./support/fixtures";
import { getTimeCaptureState, seedLegacyOpenTimeEntry } from "./support/db";
import { clockInOnJob, clockOut, createJob, openActivityDialogFromSheet } from "./support/steps";

test.describe.configure({ mode: "serial" });

function requireCanonicalSessionId(): string {
  const canonicalSessionId = checkpointValue("p1-21.canonicalSessionId");
  if (!canonicalSessionId) {
    throw new Error("Run the P1-21 start stage first; it creates the canonical session.");
  }
  return canonicalSessionId;
}

async function switchActivity(page: Page, label: string): Promise<void> {
  const dialog = await openActivityDialogFromSheet(page);
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await dialog.getByRole("button", { name: "Aktivität wechseln", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test.describe("P1-21 explicit time activities @P1-21", () => {
  test("starts one stable job-linked work session and the job lifecycle @P1-21-stage-start", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P121`;
    const title = `Zeitsegmente ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await clockInOnJob(employeePage, title);

    await expect.poll(async () => {
      const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
      return state.segments.at(-1)?.kind;
    }).toBe("work");
    const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
    const session = state.sessions.at(-1);
    expect(session).toMatchObject({ status: "open", version: 1 });
    const canonicalSessionId = session!.id;
    saveCheckpoint("p1-21.canonicalSessionId", canonicalSessionId);
    const segments = state.segments.filter((segment) => segment.session_id === canonicalSessionId);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: "work",
      allocation_kind: "job",
      ended_at: null,
    });
    expect(state.operations.filter((operation) => operation.resulting_session_id === canonicalSessionId)).toHaveLength(1);
  });

  test("switches through travel, break, standby, call-out, and internal work atomically @P1-21-stage-switch",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "starts one stable job-linked work session and the job lifecycle @P1-21-stage-start",
        },
      ],
    }, async ({
    employeePage,
    world,
  }) => {
    const sessionId = requireCanonicalSessionId();
    const expectedKinds = ["travel", "break", "standby", "callout", "internal_activity"];
    const labels = ["Fahrt", "Pause", "Bereitschaft", "Notdienst", "Intern"];
    for (const [index, label] of labels.entries()) {
      await switchActivity(employeePage, label);
      await expect.poll(async () => {
        const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
        return state.segments.at(-1)?.kind;
      }).toBe(expectedKinds[index]);
    }

    const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
    const segments = state.segments.filter((segment) => segment.session_id === sessionId);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "work", "travel", "break", "standby", "callout", "internal_activity",
    ]);
    expect(segments.filter((segment) => segment.ended_at === null)).toHaveLength(1);
    expect(state.sessions.find((session) => session.id === sessionId)?.version).toBe(6);
    expect(state.operations.filter((operation) => operation.resulting_session_id === sessionId)).toHaveLength(6);
  });

  test("ends once and preserves the append-only event chain @P1-21-stage-end",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "switches through travel, break, standby, call-out, and internal work atomically @P1-21-stage-switch",
        },
      ],
    },
    async ({ employeePage, world }) => {
    const sessionId = requireCanonicalSessionId();
    await clockOut(employeePage);
    const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
    expect(state.sessions.find((session) => session.id === sessionId)).toMatchObject({ status: "closed", version: 7 });
    const segments = state.segments.filter((segment) => segment.session_id === sessionId);
    const events = state.events.filter((event) => event.session_id === sessionId);
    expect(segments.every((segment) => segment.ended_at !== null)).toBe(true);
    expect(events.filter((event) => event.event_type === "segment_started")).toHaveLength(6);
    expect(events.filter((event) => event.event_type === "segment_ended")).toHaveLength(6);
    expect(events.at(-1)?.event_type).toBe("session_ended");
  });

  test("continues an open legacy clock into the canonical model without backfill @P1-21-stage-legacy",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "ends once and preserves the append-only event chain @P1-21-stage-end",
        },
      ],
    }, async ({
    employeePage,
    world,
  }) => {
    await seedLegacyOpenTimeEntry(world.orgId, world.users.employee.id);
    await employeePage.goto("/dashboard");
    const dialog = await openActivityDialogFromSheet(employeePage);
    await dialog.getByRole("button", { name: "Bereitschaft", exact: true }).click();
    await dialog.getByRole("button", { name: "Aktivität wechseln", exact: true }).click();

    await expect.poll(async () => {
      const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
      return state.sessions.at(-1)?.status;
    }).toBe("open");
    const state = await getTimeCaptureState(world.orgId, world.users.employee.id);
    expect(state.legacyEntries.slice(-2).map((entry) => entry.entry_type)).toEqual([
      "clock_in", "clock_out",
    ]);
    expect(state.legacyEntries.at(-1)?.capture_source).toBe("legacy_compatibility");
    const standbySegment = state.segments.at(-1);
    expect(standbySegment?.kind).toBe("standby");
    expect(standbySegment?.start_source).toBe("legacy_compatibility");
    const continuedSession = state.sessions.find(
      (session) => session.id === standbySegment?.session_id,
    );
    expect(continuedSession).toMatchObject({
      user_id: world.users.employee.id,
      status: "open",
    });
    const legacyCloseTimestamp = state.legacyEntries.at(-1)?.timestamp;
    expect(legacyCloseTimestamp).toBeTruthy();
    expect(
      state.segments.some(
        (segment) =>
          segment.session_id === continuedSession?.id &&
          legacyCloseTimestamp &&
          Date.parse(segment.started_at) < Date.parse(legacyCloseTimestamp),
      ),
    ).toBe(false);
    await clockOut(employeePage);
  });
});
