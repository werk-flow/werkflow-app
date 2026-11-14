import type { CompanyDocumentProfile } from '@/lib/company-profile/profile';
import { readCompanyProfile } from '@/lib/company-profile/reads';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getCachedMemberships } from '@/lib/data/cached';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { calculateInvoice } from '@/lib/invoicing/calculate';
import { checkEn16931, type En16931Finding } from '@/lib/invoicing/check-en16931';
import type { InvoiceDraft } from '@/lib/invoicing/model';
import { sampleInvoice } from '@/lib/invoicing/sample-invoice';
import { toEn16931 } from '@/lib/invoicing/to-en16931';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** The company profile as the invoice's seller; an empty field is no value. */
function sellerOf({ details }: CompanyDocumentProfile, organizationName: string): InvoiceDraft['seller'] {
  return {
    name: details.companyName || organizationName,
    address: {
      lines: [details.street],
      postalCode: details.postalCode,
      city: details.city,
      countryCode: 'DE',
    },
    vatId: details.vatId || null,
    taxNumber: details.taxNumber || null,
    legalRegistrationId: details.registerNumber || null,
    email: details.email || null,
  };
}

function payeeOf({ details }: CompanyDocumentProfile): InvoiceDraft['payee'] {
  const iban = details.iban.replaceAll(/\s/g, '');
  return iban ? { iban, bic: details.bic.replaceAll(/\s/g, '') || null, accountName: null } : null;
}

/** What the office fills in under „Dokumente & Briefpapier“ for a refused rule or field. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  'BR-CO-26': 'USt-IdNr. oder Handelsregisternummer',
  'BR-S-02': 'USt-IdNr. oder Steuernummer',
  'seller.name': 'Firmenname',
  'seller.address': 'Anschrift',
  'seller.email': 'E-Mail-Adresse',
  'payee.iban': 'IBAN',
  payee: 'Bankverbindung',
};

function refusalText(errors: En16931Finding[]): string {
  const lines = errors.map(
    (error) =>
      `- ${PROFILE_FIELD_LABELS[error.ruleId] ?? PROFILE_FIELD_LABELS[error.field] ?? `Angabe ${error.field}`} (Regel ${error.ruleId})`,
  );
  return [
    'Die Muster-E-Rechnung besteht die Prüfung nach EN 16931 nicht.',
    'Ergänze in den Einstellungen unter „Dokumente & Briefpapier“:',
    ...[...new Set(lines)],
    '',
  ].join('\n');
}

/**
 * The Musterrechnung as checked ZUGFeRD EN 16931 XML with the company profile
 * as seller, for Admin and Büro of the active organization only. XML the CEN
 * rules refuse is never sent: the office gets the fields to fix instead.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await withReadRequest(request, sampleInvoiceResponse);
  } catch (error) {
    logError('sampleInvoiceXml: build or check failed', error);
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
  const read = await readCompanyProfile(createSupabaseAdminClient(), context);
  if (!read.success) {
    return read.error === 'not_authorized'
      ? Response.json({ error: 'not_authorized' }, { status: 403, headers: privateHeaders })
      : Response.json({ error: 'load_failed' }, { status: 500, headers: privateHeaders });
  }
  const seller = sellerOf(read.profile, organization.name);
  const draft = sampleInvoice(seller, payeeOf(read.profile), getBusinessTodayIso());
  const xml = toEn16931(calculateInvoice(draft));
  const check = await checkEn16931(xml);
  if (!check.valid) {
    return new Response(refusalText(check.errors), {
      status: 422,
      headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(xml, {
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="Muster-E-Rechnung.xml"',
    },
  });
}
