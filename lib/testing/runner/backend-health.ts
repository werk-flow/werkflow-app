import { z } from 'zod';

/**
 * The preflight proves the application server and its backend once per verification run. A
 * service that fails later (a killed test server, a WSL gateway that refuses connections, a
 * burst of failed backend reads) otherwise looks like a product failure of the group that met
 * it. One bounded probe of the application-to-backend path before and after a browser group
 * records that evidence with the group result. The evidence only suggests an environment
 * failure: a backend that recovers between the failure and the probe, or a product defect that
 * an outage merely exposed (P1-08, 2026-09-30), still needs the trace and a classification.
 */

/** Each probe gets one attempt; a healthy local or DEV backend answers far below this. */
const BACKEND_PROBE_TIMEOUT_MS = 5_000;

export const backendHealthSchema = z.object({
  checkedAt: z.string().datetime(),
  healthy: z.boolean(),
  probes: z.array(
    z.object({
      name: z.string().min(1),
      ok: z.boolean(),
      detail: z.string(),
      durationMs: z.number().nonnegative(),
    }),
  ),
});
export type BackendHealth = z.infer<typeof backendHealthSchema>;

export type BackendProbe = {
  name: string;
  request: (signal: AbortSignal) => Promise<Response>;
  accept: (response: Response) => boolean;
};

/** The application server and the three backend services a browser group writes through. */
export function backendHealthProbes(input: {
  appOrigin: string;
  supabaseUrl: string;
  publishableKey: string;
  storageEndpoint: string;
  fetcher?: typeof fetch;
}): BackendProbe[] {
  const fetcher = input.fetcher ?? fetch;
  const headers = { apikey: input.publishableKey, Authorization: `Bearer ${input.publishableKey}` };
  return [
    {
      name: 'application server',
      request: (signal) => fetcher(`${input.appOrigin}/login`, { signal }),
      accept: (response) => response.ok,
    },
    {
      name: 'Supabase Auth',
      request: (signal) => fetcher(`${input.supabaseUrl}/auth/v1/settings`, { headers, signal }),
      accept: (response) => response.ok,
    },
    {
      // A signed-out caller holds no table grant; any answer below 500 is a completed round trip.
      name: 'Supabase data API',
      request: (signal) =>
        fetcher(`${input.supabaseUrl}/rest/v1/profiles?select=id&limit=1`, { headers, signal }),
      accept: (response) => response.status < 500,
    },
    {
      // Without a signed request any HTTP answer proves the round trip.
      name: 'object storage',
      request: (signal) => fetcher(input.storageEndpoint, { method: 'HEAD', signal }),
      accept: () => true,
    },
  ];
}

/** Runs every probe once and in parallel, so a healthy check costs one round trip. */
export async function checkBackendHealth(
  probes: readonly BackendProbe[],
  timeoutMs: number = BACKEND_PROBE_TIMEOUT_MS,
): Promise<BackendHealth> {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(
    probes.map(async (probe) => {
      const started = performance.now();
      const durationMs = (): number => Math.round(performance.now() - started);
      // A referenced timer, unlike AbortSignal.timeout under Bun, keeps the process alive until the bound.
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error(`no answer within ${timeoutMs} ms`)),
        timeoutMs,
      );
      try {
        const response = await probe.request(controller.signal);
        await response.body?.cancel();
        return {
          name: probe.name,
          ok: probe.accept(response),
          detail: `HTTP ${response.status}`,
          durationMs: durationMs(),
        };
      } catch (error) {
        return {
          name: probe.name,
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
          durationMs: durationMs(),
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return { checkedAt, healthy: results.every((result) => result.ok), probes: results };
}

/** A blip must not block a group: an unhealthy first answer gets exactly one more check. */
export const BACKEND_RECHECK_DELAY_MS = 2_000;

export async function backendHealthBeforeGroup(input: {
  check: () => Promise<BackendHealth>;
  wait: (milliseconds: number) => Promise<void>;
}): Promise<BackendHealth> {
  const first = await input.check();
  if (first.healthy) return first;
  await input.wait(BACKEND_RECHECK_DELAY_MS);
  return input.check();
}

function failedProbes(health: BackendHealth): string {
  return health.probes
    .filter((probe) => !probe.ok)
    .map((probe) => `${probe.name} (${probe.detail})`)
    .join(', ');
}

/** The reason of a browser group that did not start because the backend was down before it. */
export function backendDownBeforeGroupReason(health: BackendHealth): string {
  return `Backend unhealthy before the group, so it did not start: ${failedProbes(health)}. Repair the application server or the stack, then run bun run test:verify again.`;
}

/** The note a failed browser group's reason gains; undefined when the backend answered. */
export function backendHealthAfterFailureNote(health: BackendHealth): string | undefined {
  if (health.healthy) return undefined;
  return `Backend unhealthy right after the group: ${failedProbes(health)}. This suggests an environment failure; confirm it in the trace before you classify.`;
}
