import type { CDPSession } from '@playwright/test';

import { jsonRows, payloadShape } from '../../../lib/testing/lab-shapes';
import { classifyRouteRequest, rendersRoute } from '../../../lib/testing/route-render-count';

// The requests of a lab step (docs/technical/performance.md): what started,
// what rendered the route, and how many bytes each request shape carried on
// the wire and decoded. The browser's network events count the bytes as they
// arrive, so a streamed route render that the client stops reading still
// counts what the server sent. Bodies are measured and dropped; no body,
// header value or query value other than the background-read kind is kept.

type Tracked = {
  shape: string;
  startedAt: number;
  method: string;
  requestHeaders: Record<string, string>;
  finished: boolean;
  routeRender: boolean;
  encodedBytes: number;
  decodedBytes: number;
  json: boolean;
  rows: number | null;
};

type LabNetworkRead = {
  requests: number;
  routeRenders: number;
  actionRoundTrips: number;
  backgroundReads: number;
  prefetches: number;
  payloads: {
    shape: string;
    requests: number;
    encodedBytes: number;
    decodedBytes: number | null;
    rows: number | null;
  }[];
  routeRenderRequests: string[];
  /** Diagnosis: every request shape with its start, in milliseconds after the step began. */
  sequence: string[];
};

export type LabNetwork = {
  reset: () => void;
  inFlight: () => string[];
  /** Milliseconds since the last request started, received data or ended. */
  quietForMs: () => number;
  read: () => LabNetworkRead;
};

/** Encoded bytes are the budget of these; their decoded size says nothing more. */
const BINARY_SHAPES = new Set(['script', 'font', 'image']);

function lowerCaseHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
}

function rowsOf(text: string): number | null {
  try {
    return jsonRows(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function trackLabNetwork(cdp: CDPSession, appOrigin: string): Promise<LabNetwork> {
  let tracked = new Map<string, Tracked>();
  let lastActivity = Date.now();
  let resetAt = lastActivity;
  const touch = (): void => {
    lastActivity = Date.now();
  };
  const pending = new Set<Promise<void>>();

  cdp.on('Network.requestWillBeSent', (event) => {
    if (!/^https?:/.test(event.request.url) || tracked.has(event.requestId)) return;
    const requestHeaders = lowerCaseHeaders(event.request.headers);
    const shape = payloadShape({
      method: event.request.method,
      url: event.request.url,
      resourceType: (event.type ?? 'Other').toLowerCase(),
      headers: requestHeaders,
      appOrigin,
    });
    touch();
    tracked.set(event.requestId, {
      shape,
      startedAt: lastActivity,
      method: event.request.method,
      requestHeaders,
      finished: false,
      // A route GET or a document renders the route on the server as soon as it starts.
      routeRender: shape.startsWith('route:') || shape.startsWith('document:'),
      encodedBytes: 0,
      decodedBytes: 0,
      json: false,
      rows: null,
    });
  });
  cdp.on('Network.responseReceived', (event) => {
    const entry = tracked.get(event.requestId);
    if (!entry) return;
    touch();
    const responseHeaders = lowerCaseHeaders(event.response.headers);
    entry.routeRender ||= rendersRoute(
      classifyRouteRequest({ method: entry.method, requestHeaders: entry.requestHeaders, responseHeaders }),
    );
    entry.json = (responseHeaders['content-type'] ?? '').includes('application/json');
  });
  cdp.on('Network.dataReceived', (event) => {
    const entry = tracked.get(event.requestId);
    if (!entry) return;
    touch();
    entry.decodedBytes += event.dataLength;
    entry.encodedBytes += event.encodedDataLength;
  });
  cdp.on('Network.loadingFinished', (event) => {
    const entry = tracked.get(event.requestId);
    if (!entry) return;
    touch();
    entry.encodedBytes = Math.max(entry.encodedBytes, event.encodedDataLength);
    if (!entry.json) {
      entry.finished = true;
      return;
    }
    const body: Promise<void> = cdp
      .send('Network.getResponseBody', { requestId: event.requestId })
      .then((response) => {
        entry.rows = rowsOf(
          response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        entry.finished = true;
        touch();
        pending.delete(body);
      });
    pending.add(body);
  });
  cdp.on('Network.loadingFailed', (event) => {
    const entry = tracked.get(event.requestId);
    if (!entry) return;
    touch();
    entry.finished = true;
  });
  await cdp.send('Network.enable');

  return {
    reset: () => {
      tracked = new Map();
      touch();
      resetAt = lastActivity;
    },
    inFlight: () => [...tracked.values()].filter((entry) => !entry.finished).map((entry) => entry.shape),
    quietForMs: () => (pending.size ? 0 : Date.now() - lastActivity),
    read: () => {
      const entries = [...tracked.values()];
      const payloads = new Map<string, LabNetworkRead['payloads'][number]>();
      for (const entry of entries) {
        const decoded = BINARY_SHAPES.has(entry.shape) ? null : entry.decodedBytes;
        const current = payloads.get(entry.shape);
        if (!current) {
          payloads.set(entry.shape, {
            shape: entry.shape,
            requests: 1,
            encodedBytes: entry.encodedBytes,
            decodedBytes: decoded,
            rows: entry.rows,
          });
          continue;
        }
        current.requests += 1;
        current.encodedBytes += entry.encodedBytes;
        current.decodedBytes =
          current.decodedBytes === null || decoded === null ? null : current.decodedBytes + decoded;
        current.rows =
          current.rows === null || entry.rows === null ? null : Math.max(current.rows, entry.rows);
      }
      return {
        requests: entries.length,
        routeRenders: entries.filter((entry) => entry.routeRender).length,
        actionRoundTrips: entries.filter((entry) => entry.shape.startsWith('action:')).length,
        backgroundReads: entries.filter((entry) => entry.shape.startsWith('background:')).length,
        prefetches: entries.filter((entry) => entry.shape.startsWith('prefetch:')).length,
        payloads: [...payloads.values()].sort((left, right) => left.shape.localeCompare(right.shape)),
        routeRenderRequests: entries.filter((entry) => entry.routeRender).map((entry) => entry.shape),
        sequence: entries.map((entry) => `${entry.startedAt - resetAt} ${entry.shape}`),
      };
    },
  };
}
