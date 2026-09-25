/**
 * The local Realtime service drops its tenant connection after idle minutes
 * and lags after hours of uptime (2026-09-15: 7 to 13 s cold deliveries;
 * 2026-09-24: a fixture published after two minutes with every container
 * healthy). A verification run probes the tenant before each timing-sensitive
 * group and restarts the service once when the probe is slow or fails. The
 * probe itself opens a channel and lives in scripts/realtime-probe.ts, beside
 * the server's warm-up subscription; this module holds the decision.
 */
export type RealtimeProbeResult = { ok: true; elapsedMs: number } | { ok: false; elapsedMs: number; detail: string };

/**
 * A healthy tenant answers within `maxElapsedMs`. A slow or failed probe
 * restarts the service once; the probe after the restart must succeed (the
 * cold tenant may take longer than the healthy bound), otherwise the run stops
 * with the remedy instead of measuring against a sick service.
 */
export async function ensureRealtimeHealthy(input: {
  probe: () => Promise<RealtimeProbeResult>;
  restart: () => void;
  maxElapsedMs: number;
  log: (line: string) => void;
}): Promise<RealtimeProbeResult> {
  const first = await input.probe();
  if (first.ok && first.elapsedMs <= input.maxElapsedMs) return first;
  input.log(`Realtime readiness ${first.ok ? `took ${first.elapsedMs} ms (bound ${input.maxElapsedMs} ms)` : `failed: ${first.detail}`}; restarting the local Realtime service once.`);
  input.restart();
  const second = await input.probe();
  if (!second.ok) throw new Error(`The local Realtime service is not healthy after a restart (${second.detail}). Restart the local stack (wsl supabase stop, wsl supabase start, bun run env:local) and rerun.`);
  input.log(`Realtime readiness after the restart: ${second.elapsedMs} ms.`);
  return second;
}
