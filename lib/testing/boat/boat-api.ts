import { z } from '../../zod';

// A small client for the parts of Boat's REST API (https://docs.boat.dev/api/v1) that a
// verification run uses. It talks HTTPS with the key in memory, so the key never lands in a
// second file, a process argument or an environment variable, and it needs no SSH: files move
// through signed upload and download URLs (actions file.write and file.read), commands run
// detached (exec). The key's actions are the contract in docs/technical/boat-verification.md.

const API = 'https://boat.dev/api/v1';

/** A refusal or failure Boat answered, with its stable code. */
export class BoatError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BoatError';
  }
}

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
});

const sandboxSchema = z.object({ id: z.string(), state: z.string() });
const createdSchema = z.object({ sandbox: sandboxSchema });
const sandboxInfoSchema = z.object({ sandbox: sandboxSchema });
const fileUrlSchema = z.object({ url: z.string() });
const startedSchema = z.object({ processId: z.number().int() });
const statusSchema = z.object({
  status: z.enum(['running', 'exited', 'lost']),
  running: z.boolean(),
  exitCode: z.number().int().nullable(),
  oomKilled: z.boolean().optional(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutNextOffset: z.number().int().optional(),
  stderrNextOffset: z.number().int().optional(),
  more: z.boolean().optional(),
});
const usageSchema = z.object({ seconds: z.number(), dollars: z.number(), sandboxType: z.string() });
const deletionSchema = z.object({ operation: z.object({ id: z.string(), status: z.string() }) });
const savedSnapshotSchema = z.object({ snapshot: z.object({ status: z.string().optional() }).passthrough() });

export type CommandStatus = z.infer<typeof statusSchema>;
export type BoatUsage = z.infer<typeof usageSchema>;

export type BoatClient = ReturnType<typeof boatClient>;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The JSON a response carries, or {} when it carries none. */
async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** One signed API call; a refusal throws a BoatError with Boat's status and code, never the key. */
async function request<T>(
  signed: { key: string; fetchImpl: Fetch },
  call: {
    method: string;
    path: string;
    schema: z.ZodType<T>;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const { method, path, body } = call;
  const response = await signed.fetchImpl(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${signed.key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...call.headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await responseJson(response);
  if (response.ok) return call.schema.parse(json);
  const parsed = errorSchema.safeParse(json);
  const code = parsed.success ? (parsed.data.error?.code ?? parsed.data.code ?? 'unknown') : 'unknown';
  // Only Boat's status and a code of its known shape reach a message: a provider body is never logged.
  const safeCode = /^[a-z0-9_]{1,64}$/.test(code) ? code : 'unknown';
  throw new BoatError(response.status, safeCode, `${method} ${path}: ${response.status} ${safeCode}`);
}

/** A client that signs every request with `key`; `fetchImpl` is a test's stand-in for the network. */
export function boatClient(key: string, fetchImpl: Fetch = fetch) {
  const call = <T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> =>
    request({ key, fetchImpl }, { method, path, schema, body, ...(headers ? { headers } : {}) });

  return {
    /** Creates a sandbox and answers its id; with failFast Boat answers 503 at once when no machine is ready. */
    async create(request: Record<string, unknown>, idempotencyKey: string): Promise<string> {
      const created = await call('POST', '/sandboxes', createdSchema, request, {
        'idempotency-key': idempotencyKey,
      });
      return created.sandbox.id;
    },
    async state(id: string): Promise<string> {
      return (await call('GET', `/sandboxes/${id}`, sandboxInfoSchema)).sandbox.state;
    },
    /** Starts a command in the background; Boat keeps its output in log files on the machine. */
    async start(id: string, command: string): Promise<number> {
      return (await call('POST', `/sandboxes/${id}/commands`, startedSchema, { command, detached: true }))
        .processId;
    },
    async status(
      id: string,
      processId: number,
      offsets: { stdout: number; stderr: number },
    ): Promise<CommandStatus> {
      const query = `stdoutOffset=${offsets.stdout}&stderrOffset=${offsets.stderr}`;
      return call('GET', `/sandboxes/${id}/commands/${processId}?${query}`, statusSchema);
    },
    async stop(id: string, processId: number): Promise<void> {
      await call('DELETE', `/sandboxes/${id}/commands/${processId}`, z.unknown());
    },
    /** Writes `bytes` to `path` on the machine through a signed URL. */
    async upload(id: string, path: string, bytes: Uint8Array): Promise<void> {
      const { url } = await call('POST', `/sandboxes/${id}/files/upload-url`, fileUrlSchema, { path });
      const response = await fetchImpl(url, {
        method: 'PUT',
        body: new Blob([bytes.slice()]),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok)
        throw new BoatError(response.status, 'upload_failed', `upload of ${path}: ${response.status}`);
    },
    /** Reads `path` from the machine through a signed URL. */
    async download(id: string, path: string): Promise<Uint8Array> {
      const { url } = await call('POST', `/sandboxes/${id}/files/download-url`, fileUrlSchema, { path });
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok)
        throw new BoatError(response.status, 'download_failed', `download of ${path}: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async usage(id: string): Promise<BoatUsage> {
      return call('GET', `/sandboxes/${id}/usage`, usageSchema);
    },
    /** Asks Boat to delete the machine; Boat purges it in the background. */
    async delete(id: string): Promise<void> {
      await call('DELETE', `/sandboxes/${id}`, deletionSchema, undefined, { 'x-ascii-confirm-delete': id });
    },
    async saveSnapshot(id: string, name: string): Promise<void> {
      await call('POST', '/saved-snapshots', z.unknown(), { sandboxId: id, name });
    },
    async snapshotStatus(name: string): Promise<string | undefined> {
      return (await call('GET', `/saved-snapshots/${name}`, savedSnapshotSchema)).snapshot.status;
    },
  };
}

/** Sandbox states in which the machine accepts commands. */
export const READY_STATES = new Set(['ready', 'idle', 'running']);
/** Sandbox states a machine never leaves. */
export const FAILED_STATES = new Set(['error', 'cancelled', 'archived']);
