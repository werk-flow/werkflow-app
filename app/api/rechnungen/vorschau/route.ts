import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { officeCaller } from '@/lib/invoices/caller';
import { completenessFindings, snapshotOf } from '@/lib/invoices/issue-sources';
import { calculatedInvoiceOf, renderInvoicePdf } from '@/lib/invoices/original';
import { readInvoice } from '@/lib/invoices/reads';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/**
 * The PDF preview of a draft as it would be issued today, for Admin and Büro
 * of its organization: number „Entwurf“, no e-invoice XML inside, nothing
 * stored. An issued invoice has its filed original instead.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await withReadRequest(request, async () =>
      previewResponse(new URL(request.url).searchParams.get('rechnung') ?? ''),
    );
  } catch (error) {
    logError('invoicePreview: build or render failed', error);
    return Response.json({ error: 'render_failed' }, { status: 500, headers: privateHeaders });
  }
}

async function previewResponse(rawInvoiceId: string): Promise<Response> {
  const caller = await officeCaller();
  if (!caller.success) {
    const status = caller.error === 'not_authenticated' ? 401 : 403;
    return Response.json({ error: caller.error }, { status, headers: privateHeaders });
  }
  const { context } = caller;
  const invoiceId = uuidSchema.safeParse(rawInvoiceId);
  const invoice = invoiceId.success ? await readInvoice(context.orgId, invoiceId.data) : null;
  if (!invoice)
    return Response.json({ error: 'invoice_not_found' }, { status: 404, headers: privateHeaders });
  if (invoice.status !== 'entwurf') {
    return Response.json({ error: 'invoice_not_draft' }, { status: 409, headers: privateHeaders });
  }
  const missing = completenessFindings(invoice);
  if (missing.length > 0) {
    return new Response(
      ['Für die Vorschau fehlt noch:', ...missing.map((finding) => `- ${finding.label}`), ''].join('\n'),
      { status: 422, headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
  const admin = createSupabaseAdminClient();
  const snapshot = await snapshotOf(admin, context, invoice);
  const calculated =
    snapshot &&
    calculatedInvoiceOf(invoice, snapshot, { number: 'Entwurf', issueDate: getBusinessTodayIso() });
  if (!snapshot || !calculated) {
    return Response.json({ error: 'load_failed' }, { status: 500, headers: privateHeaders });
  }
  const units = invoice.lines.map((line) => line.unit);
  const pdf = await renderInvoicePdf(context.orgId, { calculated, units, snapshot }, null);
  return new Response(Buffer.from(pdf), {
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Rechnungsentwurf.pdf"',
    },
  });
}
