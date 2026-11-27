'use client';

import { useEffect } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useClientRead } from '@/hooks/use-client-read';
import type { ActionFailure } from '@/lib/action-result';

// A PDF a route handler of this app renders (the offer preview, the
// Musterangebot), read once as bytes and shown inline through a blob: URL,
// the one frame source besides object storage the content security policy
// allows (lib/security/csp-report.ts). Open and download use the same bytes,
// and the bytes' hash names exactly what the screen showed.

/** The PDF's blob: URL and the SHA-256 of its bytes, as lowercase hex. */
type PdfRead = { success: true; url: string; contentHash: string } | ActionFailure<'load_failed'>;

async function readPdf(path: string, signal: AbortSignal): Promise<PdfRead> {
  try {
    const response = await fetch(path, { signal, cache: 'no-store' });
    if (!response.ok) return { success: false, error: 'load_failed' };
    const blob = await response.blob();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    // The digest takes no signal: a preview closed meanwhile allocates no URL that nobody revokes.
    if (signal.aborted) return { success: false, error: 'load_failed' };
    const contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { success: true, url: URL.createObjectURL(blob), contentHash };
  } catch {
    // A lost connection is the same failure as a refused render: the retry asks again.
    return { success: false, error: 'load_failed' };
  }
}

/**
 * The PDF at `path` as a blob: URL while `enabled`; a change of `deps`
 * renders it anew. The URL is revoked once it is replaced or unmounted, and a
 * read that ends after its caller closed revokes its own.
 */
export function usePdfRead({
  path,
  deps,
  enabled = true,
  failureMessage,
}: {
  path: string;
  deps: ReadonlyArray<string | number | null>;
  enabled?: boolean;
  failureMessage: string;
}) {
  const read = useClientRead({
    read: async (signal) => {
      const pdf = await readPdf(path, signal);
      // The hook drops the answer of a read aborted since, so its URL goes here.
      if (pdf.success && signal.aborted) URL.revokeObjectURL(pdf.url);
      return pdf;
    },
    deps: [path, ...deps],
    enabled,
    failureMessage,
  });
  const url = read.data?.url;
  useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);
  return read;
}

/**
 * The PDF inline in the browser's viewer; until its URL is there, a skeleton of its size holds its place.
 * The frame is out of the tab order: Tab into it would move focus into the viewer's own
 * document, out of the dialog's focus trap. Keyboard users open the same bytes through the
 * caller's open link, in the browser's full viewer; screen readers still name the frame by `title`.
 */
export function PdfFrame({
  url,
  title,
  loadingLabel,
}: {
  url: string | undefined;
  title: string;
  loadingLabel: string;
}) {
  if (!url) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{loadingLabel}</span>
        <Skeleton className="h-[70dvh] w-full" />
      </div>
    );
  }
  return (
    <iframe
      src={`${url}#toolbar=0&navpanes=0&view=FitH`}
      title={title}
      tabIndex={-1}
      className="h-[70dvh] w-full rounded-md border bg-muted"
    />
  );
}
