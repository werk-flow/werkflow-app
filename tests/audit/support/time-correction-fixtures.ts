import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { uuidSchema } from "../../../lib/validation/uuid";
import type { Database } from "../../../lib/supabase/database.types";
import type { TimeCorrectionSnapshot } from "../../../lib/time-corrections/types";
import { resolveBerlinWallTime } from "../../../lib/planning/date-time";
import { requireEnv } from "../../golden/support/env";
import { testSupabaseClientOptions } from "../../golden/support/client-options";
import { getEmployeeRecordStateByUser } from "../../golden/support/db";
import type { TestWorld } from "../../golden/support/world";

type CorrectionArguments = Database["public"]["Functions"]["create_time_correction_request"]["Args"];
const fixtureResult = z.object({ requestId: uuidSchema, status: z.enum(["submitted", "approved"]), replayed: z.literal(false) });

export function correctionFixtureArguments(input: {
  organizationId: string;
  employeeRecordId: string;
  employeeUserId: string;
  actorUserId: string;
  date: string;
  reason: string;
}): CorrectionArguments {
  const start = resolveBerlinWallTime(`${input.date}T07:00`);
  const end = resolveBerlinWallTime(`${input.date}T09:30`);
  if (!start || !end || start.resolution !== "exact" || end.resolution !== "exact") throw new Error("Correction fixture requires an exact Berlin date.");
  const before: TimeCorrectionSnapshot = { facts: [], schemaVersion: 1 };
  const proposed: TimeCorrectionSnapshot = {
    schemaVersion: 1,
    facts: (["clock_in", "clock_out"] as const).map((entryType, index) => ({
      // Sorted keys preserve the production action's canonical digest format.
      activityKind: null, employeeRecordId: input.employeeRecordId, entryType, factId: randomUUID(),
      isManual: true, jobId: null, timestamp: (index === 0 ? start : end).instant.toISOString(), userId: input.employeeUserId,
    })),
  };
  return {
    p_organization_id: input.organizationId,
    p_subject_employee_record_id: input.employeeRecordId,
    p_actor_id: input.actorUserId,
    p_operation_id: randomUUID(),
    p_kind: "add",
    p_reason: input.reason,
    // Match the action's source-free scope and empty before-state fingerprint.
    p_source_scope_key: createHash("sha256").update(JSON.stringify({ organizationId: input.organizationId, proposedFacts: proposed.facts, sources: [], subjectEmployeeRecordId: input.employeeRecordId })).digest("hex"),
    p_source_fingerprint: createHash("sha256").update(JSON.stringify({ beforeSnapshot: before, sources: [] })).digest("hex"),
    p_before_snapshot: before,
    p_proposed_snapshot: proposed,
    p_sources: [],
    p_responsibility_snapshot: {},
  };
}

/** Setup for batch review. Real UI submission remains in the first audit case and Golden. */
export async function prepareSubmittedCorrections(world: TestWorld, requests: readonly { date: string; reason: string }[]): Promise<string[]> {
  if (world.auditGroup !== "wave-2/p1-22.spec.ts" || requests.length !== 2 || requests.some((request) => !request.reason.includes(world.runId))) {
    throw new Error("Correction batch fixtures require the owning P1-22 audit world and two run-scoped requests.");
  }
  return prepareCanonicalCorrections(world, requests, "employee", "submitted");
}

/** An unrelated approved correction tests period source selection, not correction submission. */
export async function prepareOutsidePeriodCorrection(world: TestWorld, request: { date: string; reason: string }): Promise<string> {
  if (world.auditGroup !== "wave-2/p1-23.spec.ts" || !request.reason.includes(world.runId)) throw new Error("Outside-period fixture requires its owning P1-23 audit world.");
  const [requestId] = await prepareCanonicalCorrections(world, [request], "buero", "approved");
  if (!requestId) throw new Error("Outside-period correction fixture returned no request.");
  return requestId;
}

async function prepareCanonicalCorrections(
  world: TestWorld,
  requests: readonly { date: string; reason: string }[],
  actorRole: "employee" | "buero",
  expectedStatus: "submitted" | "approved",
): Promise<string[]> {
  const endpoint = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const actor = world.users[actorRole];
  const caller = createClient<Database>(endpoint, requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), testSupabaseClientOptions);
  const { data: login, error: loginError } = await caller.auth.signInWithPassword({ email: actor.email, password: actor.password });
  if (loginError || login.user?.id !== actor.id) throw new Error("Correction fixture actor authentication failed.");
  // The production RPC is service-role-only and independently checks p_actor_id.
  // This fixture preserves the authenticated actor; it proves no Server Action auth behavior.
  const server = createClient<Database>(endpoint, requireEnv("SUPABASE_SECRET_KEY"), testSupabaseClientOptions);
  const { data: membership, error: membershipError } = await server.from("organization_members").select("role").eq("organization_id", world.orgId).eq("user_id", login.user.id).single();
  if (membershipError || membership?.role !== actorRole) throw new Error("Correction fixture actor has no matching organization membership.");
  // employee_records is manager-readable only. Production resolves this identity
  // on the server after authenticating the actor and checking membership.
  const subject = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
  if (subject.userId !== world.users.employee.id || subject.recordCountForUser !== 1 || !subject.membershipJoinedAt) {
    throw new Error("Correction fixture subject has no unique employee record and organization membership.");
  }
  const requestIds: string[] = [];
  for (const request of requests) {
    const args = correctionFixtureArguments({ organizationId: world.orgId, employeeRecordId: subject.id, employeeUserId: subject.userId, actorUserId: login.user.id, ...request });
    const { data, error } = await server.rpc("create_time_correction_request", args);
    if (error) throw new Error(`Correction fixture submission failed: ${error.message}`);
    const result = fixtureResult.parse(data);
    if (result.status !== expectedStatus) throw new Error(`Correction fixture expected ${expectedStatus}, received ${result.status}.`);
    requestIds.push(result.requestId);
  }
  return requestIds;
}
