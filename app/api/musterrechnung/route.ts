import type { CompanyDocumentProfile } from '@/lib/company-profile/profile';
import { readCompanyProfile, readOfferLetterhead } from '@/lib/company-profile/reads';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getCachedMemberships } from '@/lib/data/cached';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';
import { invoiceDocument } from '@/lib/document-rendering/invoice-layout';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { checkEn16931, type En16931Finding } from '@/lib/invoicing/check-en16931';
import { sampleInvoice } from '@/lib/invoicing/sample-invoice';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import { payeeOf, profileFieldLabel, sellerOf } from '@/lib/invoices/issue-model';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** The Musterrechnung from the company profile, dated today. */
function sampleOf({ details }: CompanyDocumentProfile, organizationName: string) {
  return sampleInvoice(sellerOf(details, organizationName), payeeOf(details), getBusinessTodayIso());
}

function refusalText(errors: En16931Finding[]): string {
  const lines = errors.map(
    (error) => `- ${profileFieldLabel(error) ?? `Angabe ${error.field}`} (Regel ${error.ruleId})`,
  );
  return [
    'Die Muster-E-Rechnung besteht die Prüfung nach EN 16931 nicht.',
    'Ergänze in den Einstellungen unter „Dokumente & Briefpapier“:',
    ...[...new Set(lines)],
    '',
  ].join('\n');
}

/**
 * The Musterrechnung as a ZUGFeRD PDF/A-3 with the company profile as seller
 * and letterhead, for Admin and Büro of the active organization only. Its
 * embedded EN 16931 XML is checked by the CEN rules first: XML they refuse is
 * never sent, the office gets the fields to fix instead.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await withReadRequest(request, sampleInvoiceResponse);
  } catch (error) {
    logError('sampleInvoicePdf: build, check or render failed', error);
    return Response.json({ error: 'render_failed' }, { status: 500, headers: privateHeaders });
  }
}

async function sampleInvoiceResponse(): Promise<Response> {
  const auth = await resolveActionContext();
  if (!auth.success) {
    const status = auth.error === 'not_authenticated' ? 401 : 403;
    return Response.json({ error: auth.error }, { status, headers: privateHeaders });
  }
  const { context } = auth;
  if (!context.isManagerOrAbove) {
    return Response.json({ error: 'not_authorized' }, { status: 403, headers: privateHeaders });
  }
  const memberships = await getCachedMemberships(context.userId);
  const organization = memberships.find((membership) => membership.orgId === context.orgId);
  if (!organization) {
    return Response.json({ error: 'not_authorized' }, { status: 403, headers: privateHeaders });
  }
  const admin = createSupabaseAdminClient();
  const [read, letterhead] = await Promise.all([
    readCompanyProfile(admin, context),
    readOfferLetterhead(admin, context, organization.name),
  ]);
  if (!read.success || !letterhead.success) {
    const error = read.success ? (letterhead.success ? 'load_failed' : letterhead.error) : read.error;
    return error === 'not_authorized'
      ? Response.json({ error: 'not_authorized' }, { status: 403, headers: privateHeaders })
      : Response.json({ error: 'load_failed' }, { status: 500, headers: privateHeaders });
  }
  const invoice = calculateInvoice(sampleOf(read.profile, organization.name));
  const xml = toEn16931(invoice);
  const check = await checkEn16931(xml);
  if (!check.valid) {
    return new Response(refusalText(check.errors), {
      status: 422,
      headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const pdf = await renderEInvoicePdf(invoiceDocument(invoice, letterhead.letterhead), xml);
  return new Response(Buffer.from(pdf), {
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Muster-E-Rechnung.pdf"',
    },
  });
}
