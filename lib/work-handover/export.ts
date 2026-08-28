import { createHash } from 'node:crypto';

import type { Json } from '@/lib/supabase/database.types';
import type { WorkHandoverTargetSnapshot } from './types';

export const WORK_HANDOVER_RENDERER_VERSION = 'p1-17-html-v1';
// Objects are serialized with recursively sorted keys. Arrays retain their
// business order, so equivalent payloads always produce identical bytes.

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export type WorkHandoverExportSource = {
  label: string;
  customerPayload: Json;
};

export type WorkHandoverExportInput = {
  releaseId: string;
  target: WorkHandoverTargetSnapshot;
  timeSummary: Json;
  materialSummary: Json;
  sources: WorkHandoverExportSource[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function renderPayload(payload: Json): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return `<p>${escapeHtml(payload)}</p>`;
  }
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== '')
    .toSorted(([left], [right]) => left.localeCompare(right, 'de'))
    .map(([label, value]) => (
      `<div class="detail"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(
        typeof value === 'object' ? canonicalStringify(value) : value
      )}</dd></div>`
    )).join('');
}

export function buildWorkHandoverExport(input: WorkHandoverExportInput): {
  html: string;
  bytes: Buffer;
  contentHash: string;
  rendererVersion: string;
  fileName: string;
} {
  const canonical = canonicalStringify({
    releaseId: input.releaseId,
    target: input.target,
    timeSummary: input.timeSummary,
    materialSummary: input.materialSummary,
    sources: input.sources,
    rendererVersion: WORK_HANDOVER_RENDERER_VERSION,
  });
  const contentHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const sourceSections = input.sources.map((source) => (
    `<section><h2>${escapeHtml(source.label)}</h2><dl>${renderPayload(source.customerPayload)}</dl></section>`
  )).join('');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Übergabepaket ${escapeHtml(input.target.number ?? input.target.title)}</title><style>@page{size:A4;margin:18mm}body{font:14px/1.5 system-ui,sans-serif;color:#222;max-width:180mm;margin:auto}header{border-bottom:2px solid #ff7900;margin-bottom:20px}h1{font-size:24px;margin-bottom:4px}h2{font-size:16px;margin:22px 0 8px}p{white-space:pre-wrap}.meta{font:11px ui-monospace,monospace;color:#555;overflow-wrap:anywhere}dl{margin:0}.detail{display:grid;grid-template-columns:150px 1fr;gap:12px;border-top:1px solid #ddd;padding:6px 0}dt{color:#666}dd{margin:0;white-space:pre-wrap}</style></head><body><header><h1>${escapeHtml(input.target.title)}</h1><p>${escapeHtml(input.target.number ?? '')}${input.target.customerName ? ` · ${escapeHtml(input.target.customerName)}` : ''}</p><p>${escapeHtml(input.target.siteName ?? '')}${input.target.siteAddress ? ` · ${escapeHtml(input.target.siteAddress)}` : ''}</p>${input.target.contactName ? `<p>Ansprechpartner: ${escapeHtml(input.target.contactName)}${input.target.contactRole ? ` · ${escapeHtml(input.target.contactRole)}` : ''}${input.target.contactEmail ? ` · ${escapeHtml(input.target.contactEmail)}` : ''}${input.target.contactPhone ? ` · ${escapeHtml(input.target.contactPhone)}` : ''}</p>` : ''}<p class="meta">Freigabe ${escapeHtml(input.releaseId)} · Renderer ${WORK_HANDOVER_RENDERER_VERSION} · Inhalts-Hash ${contentHash}</p></header><section><h2>Erfasste Zeiten</h2><dl>${renderPayload(input.timeSummary)}</dl></section><section><h2>Material</h2><dl>${renderPayload(input.materialSummary)}</dl></section>${sourceSections}</body></html>`;
  return {
    html,
    bytes: Buffer.from(html, 'utf8'),
    contentHash,
    rendererVersion: WORK_HANDOVER_RENDERER_VERSION,
    fileName: `Uebergabepaket-${(input.target.number ?? input.target.targetId).replace(/[^a-zA-Z0-9_-]/g, '-')}-${contentHash.slice(0, 8)}.html`,
  };
}
