import { readOfferLetterhead } from '@/lib/company-profile/reads';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getCachedMemberships } from '@/lib/data/cached';
import { renderBusinessDocument } from '@/lib/document-rendering/render';
import { sampleOffer } from '@/lib/document-rendering/sample-offer';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** The Musterangebot as PDF with the company profile, for Admin and Büro of the active organization only. */
export async function GET(): Promise<Response> {
  try {
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
    const read = await readOfferLetterhead(createSupabaseAdminClient(), context, organization.name);
    if (!read.success) {
      return read.error === 'not_authorized'
        ? Response.json({ error: 'not_authorized' }, { status: 403, headers: privateHeaders })
        : Response.json({ error: 'load_failed' }, { status: 500, headers: privateHeaders });
    }
    const bytes = await renderBusinessDocument(sampleOffer(read.letterhead, getBusinessTodayIso()));
    return new Response(Buffer.from(bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Musterangebot.pdf"',
      },
    });
  } catch (error) {
    logError('sampleOfferPdf: render failed', error);
    return Response.json({ error: 'render_failed' }, { status: 500, headers: privateHeaders });
  }
}
