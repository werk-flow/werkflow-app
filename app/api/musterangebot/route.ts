import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getCachedMemberships } from '@/lib/data/cached';
import { renderBusinessDocument } from '@/lib/document-rendering/render';
import { sampleOffer } from '@/lib/document-rendering/sample-offer';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** The Musterangebot as PDF, for Admin and Büro of the active organization only. */
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
    const bytes = await renderBusinessDocument(sampleOffer(organization.name, getBusinessTodayIso()));
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
