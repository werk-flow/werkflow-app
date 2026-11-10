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

const sandboxSchema = z.object({
  id: z.string(),
  state: z.string(),
  /** When Boat stops the machine by itself; a machine without snapshots is then erased. */
  archiveAfter: z.string().nullable().optional(),
});
const createdSchema = z.object({ sandbox: sandboxSchema });
const sandboxInfoSchema = z.object({ sandbox: sandboxSchema });
const sandboxListSchema = z.object({ sandboxes: z.array(sandboxSchema) });
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
export type Sandbox = z.infer<typeof sandboxSchema>;
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
    /** Ends the call early, as a transfer attempt's deadline or the user's interruption does. */
    signal?: AbortSignal;
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
    signal: call.signal
      ? AbortSignal.any([call.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  const json = await responseJson(response);
  if (response.ok) return call.schema.parse(json);
  const parsed = errorSchema.safeParse(json);
  const code = parsed.success ? (parsed.data.error?.code ?? parsed.data.code ?? 'unknown') : 'unknown';
  // Only Boat's status and a code of its known shape reach a message: a provider body is never logged.
  const safeCode = /^[a-z0-9_]{1,64}$/.test(code) ? code : 'unknown';
  throw new BoatError(response.status, safeCode, `${method} ${path}: ${response.status} ${safeCode}`);
}

/** A fresh signed URL for one file transfer; `signal` ends the request, as it ends the transfer. */
async function signedUrl(
  signed: { key: string; fetchImpl: Fetch },
  endpoint: string,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const { url } = await request(signed, {
    method: 'POST',
    path: endpoint,
    schema: fileUrlSchema,
    body: { path },
    signal,
  });
  return url;
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
    async sandbox(id: string): Promise<Sandbox> {
      return (await call('GET', `/sandboxes/${id}`, sandboxInfoSchema)).sandbox;
    },
    /** The organization's machines that are not stopped and carry every label in `labels`. */
    async list(labels: Record<string, string>): Promise<Sandbox[]> {
      const query = new URLSearchParams({ state: [...STARTED_STATES].join(','), limit: '100' });
      for (const [name, value] of Object.entries(labels)) query.append('label', `${name}=${value}`);
      return (await call('GET', `/sandboxes?${query}`, sandboxListSchema)).sandboxes;
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
    /** Writes `bytes` to `path` on the machine through a fresh signed URL; `signal` ends the write. */
    async upload(
      id: string,
      path: string,
      bytes: Uint8Array,
      signal: AbortSignal = AbortSignal.timeout(600_000),
    ): Promise<void> {
      const url = await signedUrl({ key, fetchImpl }, `/sandboxes/${id}/files/upload-url`, path, signal);
      const response = await fetchImpl(url, { method: 'PUT', body: new Blob([bytes.slice()]), signal });
      if (!response.ok)
        throw new BoatError(response.status, 'upload_failed', `upload of ${path}: ${response.status}`);
    },
    /** Reads `path` from the machine through a fresh signed URL; `signal` ends the read. */
    async download(
      id: string,
      path: string,
      signal: AbortSignal = AbortSignal.timeout(600_000),
    ): Promise<Uint8Array> {
      const url = await signedUrl({ key, fetchImpl }, `/sandboxes/${id}/files/download-url`, path, signal);
      const response = await fetchImpl(url, { signal });
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
/** Sandbox states of a machine that is starting or started, and so holds or bills something. */
const STARTED_STATES = new Set(['init', 'provisioning', 'provisioned', 'cloning', ...READY_STATES]);
/** Sandbox states a machine never leaves. */
export const FAILED_STATES = new Set(['error', 'cancelled', 'archived']);
