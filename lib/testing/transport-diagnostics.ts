export type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type TransportErrorMetadata = {
  depth: number;
  name: string;
  code?: string;
  syscall?: string;
};

export type TransportDiagnostic = {
  event: 'test-fetch-rejected';
  method: string;
  origin: string | null;
  errors: TransportErrorMetadata[];
};

const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AggregateError', 'AbortError', 'TimeoutError', 'FetchError', 'SystemError']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);
const SYSCALLS = new Set(['connect', 'read', 'write', 'getaddrinfo', 'getnameinfo', 'socket', 'bind', 'listen', 'accept', 'send', 'recv', 'sendto', 'recvfrom', 'shutdown']);
const ERROR_CODES = new Set([
  'EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EAGAIN', 'EAI_AGAIN', 'EAI_FAIL',
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTDOWN', 'EHOSTUNREACH', 'EINVAL', 'EMFILE', 'ENFILE',
  'ENETDOWN', 'ENETRESET', 'ENETUNREACH', 'ENOBUFS', 'ENOENT', 'ENOMEM', 'ENOTFOUND', 'ENOTCONN',
  'EPIPE', 'EPROTO', 'ETIMEDOUT', 'ERR_INVALID_URL', 'ERR_NETWORK', 'ABORT_ERR',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'UND_ERR_ABORTED', 'UND_ERR_DESTROYED', 'UND_ERR_CLOSED', 'UND_ERR_RESPONSE_STATUS_CODE',
  'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
]);

function safeField(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function errorMetadata(error: unknown): TransportErrorMetadata[] {
  const result: TransportErrorMetadata[] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number): void {
    if (depth > 4 || result.length >= 8 || seen.has(value)) return;
    seen.add(value);
    const name = safeField(value, 'name');
    const code = safeField(value, 'code');
    const syscall = safeField(value, 'syscall');
    result.push({
      depth,
      name: typeof name === 'string' && ERROR_NAMES.has(name) ? name : 'UnknownError',
      ...(typeof code === 'string' && ERROR_CODES.has(code) ? { code } : {}),
      ...(typeof syscall === 'string' && SYSCALLS.has(syscall) ? { syscall } : {}),
    });
    const cause = safeField(value, 'cause');
    if (cause !== undefined) visit(cause, depth + 1);
    const errors = safeField(value, 'errors');
    if (Array.isArray(errors)) {
      for (const nested of errors.slice(0, 8)) visit(nested, depth + 1);
    }
  }
  visit(error, 0);
  return result;
}

function diagnosticFor(input: unknown, init: unknown, error: unknown): TransportDiagnostic {
  const request = input instanceof Request ? input : null;
  const suppliedMethod = safeField(init, 'method');
  const method = (typeof suppliedMethod === 'string' ? suppliedMethod : request?.method ?? 'GET').toUpperCase();
  let origin: string | null = null;
  try {
    const address = request?.url ?? (typeof input === 'string' || input instanceof URL ? input : null);
    const url = address === null ? null : new URL(address);
    if (url?.protocol === 'http:' || url?.protocol === 'https:') origin = url.origin;
  } catch {
    // Invalid input remains the original fetch failure; never log its raw value.
  }
  return {
    event: 'test-fetch-rejected',
    method: METHODS.has(method) ? method : 'OTHER',
    origin,
    errors: errorMetadata(error),
  };
}

type DiagnosticRecorder = (diagnostic: TransportDiagnostic) => void | Promise<void>;

/** A connection that never carried the request; the read can be sent again without a second write. */
const RETRIED_READ_CODES = new Set(['EACCES', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
const READ_RETRY_DELAY_MS = 250;

function retriesAsRead(diagnostic: TransportDiagnostic): boolean {
  return (diagnostic.method === 'GET' || diagnostic.method === 'HEAD') && diagnostic.errors.some((error) => error.code !== undefined && RETRIED_READ_CODES.has(error.code));
}

/**
 * Test-client observability, plus one retry of an idempotent read whose
 * connection failed: a write is attempted exactly once, a rejected read is
 * recorded and, for a connection-level cause, sent a second time.
 */
export function createTransportDiagnosticFetch(options?: { record?: DiagnosticRecorder }): typeof globalThis.fetch;
export function createTransportDiagnosticFetch<Fetch extends TestFetch>(options: {
  fetchImplementation: Fetch;
  record?: DiagnosticRecorder;
}): Fetch & TestFetch;
export function createTransportDiagnosticFetch(options: {
  fetchImplementation?: TestFetch;
  record?: DiagnosticRecorder;
} = {}): TestFetch {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const record = options.record ?? ((diagnostic: TransportDiagnostic): void => {
    console.error('[test-fetch-rejected]', diagnostic);
  });
  // Forward all properties (including Bun's preconnect) and preserve the original call receiver.
  return new Proxy(fetchImplementation, {
    async apply(target, receiver: unknown, argumentsList: unknown[]): Promise<Response> {
      try {
        return await Reflect.apply(target, receiver, argumentsList);
      } catch (error) {
        let diagnostic: TransportDiagnostic | null = null;
        try {
          diagnostic = diagnosticFor(argumentsList[0], argumentsList[1], error);
          // Async recorders are best-effort: neither slow I/O nor rejection delays the request failure.
          void Promise.resolve(record(diagnostic)).catch(() => undefined);
        } catch {
          // Diagnostic failure must never replace the request's original rejection.
        }
        if (!diagnostic || !retriesAsRead(diagnostic)) throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, READ_RETRY_DELAY_MS));
        return await Reflect.apply(target, receiver, argumentsList);
      }
    },
  });
}
