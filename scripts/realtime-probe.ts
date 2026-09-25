import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import type { RealtimeProbeResult } from "../lib/testing/realtime-health";

/**
 * Realtime readiness of the local tenant, measured the way the server's warm-up
 * subscription measures it: a channel subscribed to database changes, resolved
 * by the tenant's readiness message. Command-only code beside
 * scripts/test-server.ts; the application opens no channel outside its provider.
 */
export function subscribeForDatabaseReadiness(channel: RealtimeChannel, timeoutMs: number): Promise<"ok" | string> {
  return new Promise<"ok" | string>((resolveAttempt) => {
    const timer = setTimeout(() => resolveAttempt(`no readiness message within ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
    channel
      .on("system", {}, (payload: unknown) => {
        if (!payload || typeof payload !== "object" || !("extension" in payload) || payload.extension !== "postgres_changes" || !("status" in payload)) return;
        clearTimeout(timer);
        resolveAttempt(payload.status === "ok" ? "ok" : `postgres changes ${String(payload.status)}`);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "organization_settings" }, () => {})
      .subscribe((status: string, error?: Error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolveAttempt(`join ${status}${error ? ` (${error.message})` : ""}`);
        }
      });
  });
}

/** One readiness round trip as a throwaway confirmed user; the user is deleted on every exit. */
export async function probeRealtimeReadiness(input: { url: string; publishableKey: string; secretKey: string; timeoutMs?: number }): Promise<RealtimeProbeResult> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  const admin = createClient(input.url, input.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `realtime-probe-${process.pid}-${Date.now()}@werkflow.local`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) return { ok: false, elapsedMs: Date.now() - startedAt, detail: `could not create the probe user: ${created.error?.message ?? "no user"}` };
  const client = createClient(input.url, input.publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { timeout: timeoutMs } });
  const channel = client.channel(`werkflow-realtime-probe-${Date.now()}`);
  try {
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) return { ok: false, elapsedMs: Date.now() - startedAt, detail: `could not sign in the probe user: ${signedIn.error?.message ?? "no session"}` };
    await client.realtime.setAuth(signedIn.data.session.access_token);
    const outcome = await subscribeForDatabaseReadiness(channel, timeoutMs);
    const elapsedMs = Date.now() - startedAt;
    return outcome === "ok" ? { ok: true, elapsedMs } : { ok: false, elapsedMs, detail: outcome };
  } finally {
    await client.removeChannel(channel);
    client.realtime.disconnect();
    await admin.auth.admin.deleteUser(created.data.user.id).catch(() => undefined);
  }
}

export function restartLocalRealtimeContainer(): void {
  execFileSync("wsl.exe", ["-e", "docker", "restart", "supabase_realtime_werkflow-app"], { stdio: "ignore", timeout: 120_000, windowsHide: true });
}
