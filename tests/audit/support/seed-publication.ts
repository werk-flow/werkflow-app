import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../lib/supabase/database.types";
import { waitForFixturePublication } from "../../../lib/testing/fixture-publication";
import { testSupabaseClientOptions } from "../../golden/support/client-options";
import { requireEnv } from "../../golden/support/env";
import { currentRunKey, runDirectory } from "../../golden/support/run-state";
import type { TestWorld } from "../../golden/support/world";

/** Insert the last fixture transaction and await its authenticated publication receipt. */
export async function insertFinalFixtureTimeEntry(options: {
  admin: SupabaseClient<Database>;
  world: TestWorld;
  row: Database["public"]["Tables"]["time_entries"]["Insert"] & { id: string };
  /** The publication deadline; a long campaign lets Realtime lag past the default minute. */
  timeoutMs?: number;
}): Promise<void> {
  if (options.row.organization_id !== options.world.orgId) throw new Error("Fixture marker must belong to its owned organization.");
  const receiver = createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), testSupabaseClientOptions);
  const startedAt = performance.now();
  try {
    const { data, error } = await receiver.auth.signInWithPassword({
      email: options.world.users.admin.email, password: options.world.users.admin.password,
    });
    if (error || !data.session) throw new Error("Fixture publication receiver could not authenticate.");
    await receiver.realtime.setAuth(data.session.access_token);
    await waitForFixturePublication({
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      subscribe: (observer) => {
        let joined = false;
        let postgresReady = false;
        const ready = (): void => { if (joined && postgresReady) observer.ready(); };
        const channel = receiver.channel(`fixture-complete-${options.row.id}`)
          .on("system", {}, (payload) => {
            if (payload.status === "ok" && payload.extension === "postgres_changes") { postgresReady = true; ready(); }
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "time_entries", filter: `id=eq.${options.row.id}` }, (payload) => {
            if (payload.new.id === options.row.id && payload.new.organization_id === options.world.orgId) observer.marker();
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") { joined = true; ready(); }
            if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) observer.failed(new Error(`Fixture publication channel failed: ${status}`));
          });
        return async () => { await receiver.removeChannel(channel); };
      },
      write: async () => {
        const { error: writeError } = await options.admin.from("time_entries").insert(options.row);
        if (writeError) throw new Error(`Final fixture transaction failed: ${writeError.code}`);
      },
    });
    appendFileSync(resolve(runDirectory(currentRunKey()), "fixture-readiness.ndjson"),
      `${JSON.stringify({ boundary: "fixture-receiver-setup-to-final-transaction-receipt", organizationId: options.world.orgId,
        table: "time_entries", markerId: options.row.id, measuredMs: performance.now() - startedAt })}\n`);
  } finally {
    await receiver.removeAllChannels();
  }
}
