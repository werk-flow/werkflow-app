import 'server-only';

import { documentText } from '@/lib/ai/context';
import { runExtraction } from '@/lib/ai/extract/call';
import { LIEFERSCHEIN_EXTRACTION, cappedLieferschein } from '@/lib/ai/extract/lieferschein';
import { AI_TURN_LIMITS, AI_UPLOAD_LIMITS } from '@/lib/ai/limits';
import { type AiToolRun, defineTool } from '@/lib/ai/tools/define-tool';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { readStorageObject } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

// „Lieferschein lesen“ (werk-flow/werkflow-planning#535): reads one file the
// caller attached in this thread through the quarantined extractor (B9) and
// gives the model only the capped fields, each document text labelled as
// such. Nothing is booked: the goods receipt from a read Lieferschein comes
// with werk-flow/werkflow-planning#544.

/** The fixed sentences the model passes on when a file cannot be read; never text from the file. */
const MESSAGES = {
  noFile:
    'In diesem Gespräch ist unter dieser Nummer keine Datei angehängt. Bitte die Person, den Lieferschein als PDF oder Foto anzuhängen.',
  tooLong: `Die Datei ist zu lang zum Lesen. Ein Lieferschein darf höchstens etwa 15 Seiten haben und ${
    AI_UPLOAD_LIMITS.maxFileBytes / 1024 / 1024
  } MB groß sein; die Person kann die Seiten mit den Positionen einzeln anhängen.`,
  unreadable:
    'Aus der Datei ließ sich kein Lieferschein lesen. Bitte die Person um ein schärferes Foto oder das PDF des Großhändlers.',
  overCap: `In einer Antwort lese ich höchstens ${AI_TURN_LIMITS.chat.maxToolModelCalls} Dateien. Die Person kann die nächste in einer neuen Nachricht schicken.`,
} as const;

/** How far back the model may count the thread's files. */
const MAX_POSITION = 20;

const mimeTypeSchema = z.enum(AI_UPLOAD_LIMITS.mimeTypes);
const fileSchema = z.object({ storage_path: z.string(), mime_type: mimeTypeSchema, size_bytes: z.number() });

/**
 * The caller's own upload in the turn's thread before the turn's message,
 * counted back from the newest file item: 1 is the latest. Another person's file is never found: the row
 * must be the caller's in the caller's organization.
 */
async function readThreadFile(ctx: ActionContext, run: AiToolRun, position: number) {
  const admin = createSupabaseAdminClient();
  const items = await admin
    .from('ai_thread_items')
    .select('id, sequence')
    .eq('organization_id', ctx.orgId)
    .eq('thread_id', run.threadId)
    .eq('kind', 'file')
    // A later message's file, such as one another tab sent while this turn ran, is never this turn's.
    .lt('sequence', run.beforeSequence)
    .order('sequence', { ascending: false })
    .range(0, MAX_POSITION - 1)
    .abortSignal(run.signal);
  if (items.error) {
    logError('lieferscheinLesen: file item read failed', items.error);
    return 'failed';
  }
  const item = items.data.toSorted((left, right) => right.sequence - left.sequence)[position - 1];
  if (!item) return null;
  const file = await admin
    .from('ai_thread_files')
    .select('storage_path, mime_type, size_bytes')
    .eq('organization_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .eq('item_id', item.id)
    .abortSignal(run.signal)
    .maybeSingle();
  if (file.error) {
    logError('lieferscheinLesen: file read failed', file.error);
    return 'failed';
  }
  return file.data ? (fileSchema.safeParse(file.data).data ?? null) : null;
}

export const lieferscheinLesen = defineTool({
  name: 'lieferschein_lesen',
  label: 'Lieferschein lesen',
  description:
    'Liest einen Lieferschein (PDF oder Foto), den die Person im Gespräch angehängt hat: Lieferant, Nummer, Datum und Positionen als KI-Entwurf. Bucht nichts.',
  input: z.strictObject({
    datei: z.number().int().min(1).max(MAX_POSITION).describe('1 = zuletzt angehängte Datei, 2 = die davor'),
  }),
  roles: ['admin', 'buero'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['document'],
  writesMemory: false,
  async execute(input, ctx, run) {
    // Nothing is read for a call the turn could not send to the extractor anyway.
    if (!run.canCallModel()) return { status: 'refused', message: MESSAGES.overCap };
    const file = await readThreadFile(ctx, run, input.datei);
    if (file === 'failed' || run.signal.aborted) return { status: 'failed' };
    if (!file) return { status: 'refused', message: MESSAGES.noFile };
    // The stored size is checked at upload; the bytes read now are checked again.
    if (file.size_bytes > AI_UPLOAD_LIMITS.maxFileBytes)
      return { status: 'refused', message: MESSAGES.tooLong };
    const bytes = await readStorageObject({
      organizationId: ctx.orgId,
      path: file.storage_path,
      abortSignal: run.signal,
    });
    if (bytes.byteLength > AI_UPLOAD_LIMITS.maxFileBytes)
      return { status: 'refused', message: MESSAGES.tooLong };

    const read = await runExtraction(LIEFERSCHEIN_EXTRACTION, { bytes, mimeType: file.mime_type }, run);
    if (read.status === 'too_long') return { status: 'refused', message: MESSAGES.tooLong };
    if (read.status === 'over_cap') return { status: 'refused', message: MESSAGES.overCap };
    if (read.status === 'stopped' || read.status === 'failed') return { status: 'failed' };
    const lieferschein = read.status === 'read' ? cappedLieferschein(read.answer) : null;
    if (!lieferschein) return { status: 'refused', message: MESSAGES.unreadable };
    return {
      status: 'ok',
      value: {
        hinweis: 'KI-Entwurf: aus dem Dokument gelesen, von niemandem geprüft und nicht gebucht.',
        lieferant: documentText(lieferschein.lieferant),
        lieferscheinnummer: documentText(lieferschein.lieferscheinnummer),
        datum: lieferschein.datum,
        positionen: lieferschein.positionen.map((line, index) => ({
          nr: index + 1,
          artikelnummer: documentText(line.artikelnummer),
          ean: line.ean,
          beschreibung: documentText(line.beschreibung),
          menge: line.menge,
          einheit: documentText(line.einheit),
          packungsinhalt: line.packungsinhalt,
        })),
        // Null when the count of left-out lines is unknown.
        weggelassenePositionen: lieferschein.weggelassen,
      },
    };
  },
});
