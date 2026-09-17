import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Database } from "../../../lib/supabase/database.types";
import { resolveBerlinWallTime } from "../../../lib/planning/date-time";
import { shiftIsoDateByDays } from "../../../lib/personnel/types";
import { requireEnv } from "../../golden/support/env";
import { testSupabaseClientOptions } from "../../golden/support/client-options";
import type { TestWorld } from "../../golden/support/world";
import { currentRunKey, runDirectory } from "../../golden/support/run-state";
import { insertFinalFixtureTimeEntry } from "./seed-publication";

/**
 * The "typical beta example" workload from the Step 2 plan, generated inside
 * the performance group's own organization with the admin client. Rows use
 * deterministic names and dates so a run is reproducible, and the owned
 * organization cascade deletes everything with the world. Nothing here
 * pre-completes an operation a test claims to prove; the scenarios only
 * navigate and read.
 */

export const TYPICAL_PROFILE = {
  employees: 10,
  occurrencesPerDay: 40,
  customers: 1_000,
  jobs: 2_500,
  timeEntriesPerWorkday: 4,
  /** Jobs that carry the calendar occurrences; the rest are history. */
  jobsWithVisits: 400,
} as const;

/** Fixed historical benchmark date; the browser follows the real calendar deep link. */
export const TYPICAL_PROFILE_BUSINESS_DATE = "2026-06-15";

export type TypicalProfileCounts = {
  employeeRecords: number;
  customers: number;
  jobs: number;
  occurrences: number;
  assignments: number;
  timeEntries: number;
  /** All 44 synthetic dates carry the same busy-day workload, including weekends. */
  window: { from: string; to: string; days: number };
  workdays: number;
  /** The world employee assigned to the newest job (renders first on /auftraege). */
  assignedJobNumber: string;
};

type Tables = Database["public"]["Tables"];

function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    testSupabaseClientOptions,
  );
}

async function insertInBatches<T extends keyof Tables>(
  admin: SupabaseClient<Database>,
  table: T,
  rows: Tables[T]["Insert"][],
  batchSize = 500,
): Promise<void> {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await admin.from(table).insert(batch as never);
    if (error) throw new Error(`Failed to seed ${String(table)} batch ${index / batchSize + 1}: ${error.message}`);
  }
}

/** Berlin instant for a local wall time on an ISO date; throws on an impossible time. */
function berlinInstant(dateIso: string, time: string): string {
  const resolved = resolveBerlinWallTime(`${dateIso}T${time}`);
  if (!resolved) throw new Error(`Cannot resolve ${dateIso}T${time} in Europe/Berlin.`);
  return resolved.instant.toISOString();
}

/** The six-week month grid window (Monday before the 1st minus one day, 44 days) as ISO dates. */
export function monthWindowDates(businessDate: string): { from: string; to: string; days: number } {
  const firstOfMonth = `${businessDate.slice(0, 7)}-01`;
  const weekday = new Date(`${firstOfMonth}T12:00:00Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const from = shiftIsoDateByDays(firstOfMonth, -daysSinceMonday - 1);
  const to = shiftIsoDateByDays(from, 43);
  return { from, to, days: 44 };
}

function isWeekday(dateIso: string): boolean {
  const weekday = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export async function seedTypicalProfile(world: TestWorld): Promise<TypicalProfileCounts> {
  const businessDate = TYPICAL_PROFILE_BUSINESS_DATE;
  const admin = createAdminClient();
  const organizationId = world.orgId;
  const actorId = world.users.admin.id;

  // Employee records: membership triggers created one per member; add
  // personnel without a login until the profile size is reached.
  const { data: existingRecords, error: recordsError } = await admin
    .from("employee_records")
    .select("id, user_id")
    .eq("organization_id", organizationId);
  if (recordsError) throw new Error(`Failed to read employee records: ${recordsError.message}`);
  const missing = Math.max(0, TYPICAL_PROFILE.employees - (existingRecords?.length ?? 0));
  await insertInBatches(admin, "employee_records", Array.from({ length: missing }, (_, index) => ({
    organization_id: organizationId,
    first_name: `Personal ${index + 1}`,
    last_name: `Ohne Login ${world.runId.slice(0, 6)}`,
    created_by: actorId,
  })));
  const { data: records, error: allRecordsError } = await admin
    .from("employee_records")
    .select("id, user_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (allRecordsError || !records) throw new Error(`Failed to reload employee records: ${allRecordsError?.message}`);

  // Customers with a deterministic long tail of names and addresses.
  const clientIds = Array.from({ length: TYPICAL_PROFILE.customers }, () => crypto.randomUUID());
  await insertInBatches(admin, "clients", clientIds.map((id, index) => ({
    id,
    organization_id: organizationId,
    name: `Kunde ${String(index + 1).padStart(4, "0")} ${world.runId.slice(0, 6)}`,
    client_type: index % 5 === 0 ? "gewerblich" : "privat",
    address: `Musterstraße ${(index % 200) + 1}, ${10000 + (index % 900)} Musterstadt`,
    phone: index % 3 === 0 ? `+49 30 ${String(100000 + index).slice(0, 6)}` : null,
    email: index % 4 === 0 ? `kunde${index}@example.invalid` : null,
  })));

  // Jobs: the first `jobsWithVisits` carry calendar visits; the rest are a
  // realistic active/archived history. The newest job is assigned to the
  // world employee so the /auftraege list proves that assignments render.
  const jobIds = Array.from({ length: TYPICAL_PROFILE.jobs }, () => crypto.randomUUID());
  const jobNumber = (index: number): string => `PERF-${world.runId.slice(0, 6)}-${String(index + 1).padStart(4, "0")}`;
  const jobIdAt = (index: number): string => {
    const id = jobIds[index];
    if (!id) throw new Error(`No synthetic job id at index ${index}.`);
    return id;
  };
  await insertInBatches(admin, "jobs", jobIds.map((id, index) => {
    const clientId = clientIds[index % clientIds.length];
    if (!clientId) throw new Error(`No synthetic client id for job ${index + 1}.`);
    return {
      id,
      organization_id: organizationId,
      created_by: actorId,
      job_number: jobNumber(index),
      title: `Auftrag ${index + 1}: ${index % 2 === 0 ? "Heizung warten" : "Bad sanieren"}`,
      created_at: new Date(Date.UTC(2025, 0, 1) + index * 1000).toISOString(),
      description: index % 7 === 0 ? "Langer Beschreibungstext ".repeat(20).trim() : null,
      client_id: clientId,
      status: index < TYPICAL_PROFILE.jobsWithVisits ? "nicht_bearbeitet" : index % 10 < 6 ? "fertig" : index % 10 < 9 ? "nicht_bearbeitet" : "in_bearbeitung",
      priority: index % 11 === 0 ? "hoch" : "mittel",
      estimated_duration_minutes: 60 + (index % 4) * 60,
    };
  }));
  const assignedJobIndex = TYPICAL_PROFILE.jobs - 1;
  const { error: assignmentError } = await admin.from("job_assignments").insert({
    organization_id: organizationId,
    job_id: jobIdAt(assignedJobIndex),
    user_id: world.users.employee.id,
    assigned_by: actorId,
  });
  if (assignmentError) throw new Error(`Failed to seed the job assignment: ${assignmentError.message}`);

  // Occurrences: 40 timed visits on every synthetic day of the month window,
  // including weekends so the measured initial day never becomes an empty case.
  // Visits start between
  // 07:00 and 15:00 with one- to three-hour durations, so a day view shows
  // overlapping work across the ten people.
  const window = monthWindowDates(businessDate);
  const occurrences: Tables["planning_occurrences"]["Insert"][] = [];
  const assignments: Tables["planning_occurrence_assignments"]["Insert"][] = [];
  let workdays = 0;
  for (let day = 0; day < window.days; day += 1) {
    const dateIso = shiftIsoDateByDays(window.from, day);
    if (isWeekday(dateIso)) workdays += 1;
    for (let slot = 0; slot < TYPICAL_PROFILE.occurrencesPerDay; slot += 1) {
      const id = crypto.randomUUID();
      const startHour = 7 + (slot % 9);
      const durationHours = 1 + (slot % 3);
      occurrences.push({
        id,
        organization_id: organizationId,
        entry_kind: "job_visit",
        time_kind: "timed",
        job_id: jobIdAt((day * TYPICAL_PROFILE.occurrencesPerDay + slot) % TYPICAL_PROFILE.jobsWithVisits),
        start_at: berlinInstant(dateIso, `${String(startHour).padStart(2, "0")}:00`),
        end_at: berlinInstant(dateIso, `${String(startHour + durationHours).padStart(2, "0")}:00`),
        created_by: actorId,
      });
      const primary = records[slot % records.length];
      if (!primary) throw new Error("No employee record for the primary occurrence assignment.");
      assignments.push({ organization_id: organizationId, occurrence_id: id, employee_record_id: primary.id, assigned_by: actorId });
      if (slot % 10 === 0) {
        const secondary = records[(slot + 1) % records.length];
        if (!secondary) throw new Error("No employee record for the secondary occurrence assignment.");
        assignments.push({ organization_id: organizationId, occurrence_id: id, employee_record_id: secondary.id, assigned_by: actorId });
      }
    }
  }
  await insertInBatches(admin, "planning_occurrences", occurrences);
  await insertInBatches(admin, "planning_occurrence_assignments", assignments);

  // Actual time: every member with a login clocks a full day with one break
  // on each past workday of the window.
  const usersWithLogin = records.flatMap((record) => (record.user_id ? [record.user_id] : []));
  const timeEntries: Tables["time_entries"]["Insert"][] = [];
  for (let day = 0; day < window.days; day += 1) {
    const dateIso = shiftIsoDateByDays(window.from, day);
    if (dateIso > businessDate || !isWeekday(dateIso)) continue;
    for (const userId of usersWithLogin) {
      for (const [entryType, time] of [["clock_in", "07:00"], ["break_start", "12:00"], ["break_end", "12:30"], ["clock_out", "16:00"]] as const) {
        // Historical rows are manual entries: automatic ones must sit within five minutes of now.
        timeEntries.push({ organization_id: organizationId, user_id: userId, entry_type: entryType, timestamp: berlinInstant(dateIso, time), status: "approved", is_manual: true });
      }
    }
  }
  const finalEntry = timeEntries.at(-1);
  if (!finalEntry) throw new Error("The typical profile needs a final time entry to confirm fixture publication.");
  await insertInBatches(admin, "time_entries", timeEntries.slice(0, -1));
  await insertFinalFixtureTimeEntry({ admin, world, row: { ...finalEntry, id: crypto.randomUUID() } });

  const counts: TypicalProfileCounts = {
    employeeRecords: records.length,
    customers: clientIds.length,
    jobs: jobIds.length,
    occurrences: occurrences.length,
    assignments: assignments.length,
    timeEntries: timeEntries.length,
    window,
    workdays,
    assignedJobNumber: jobNumber(assignedJobIndex),
  };
  writeFileSync(resolve(runDirectory(currentRunKey()), "performance-workload.json"), JSON.stringify({
    profile: "typical", businessDate, definition: TYPICAL_PROFILE,
    counts: { employeeRecords: counts.employeeRecords, customers: counts.customers, jobs: counts.jobs, occurrences: counts.occurrences,
      assignments: counts.assignments, timeEntries: counts.timeEntries, window: counts.window, workdays: counts.workdays },
  }, null, 2));
  return counts;
}
