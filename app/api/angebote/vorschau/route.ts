import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { readOffer } from '@/lib/offers/reads';
import { renderOfferPdf } from '@/lib/offers/sending';
import { resolveManagerContext } from '@/lib/org/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/**
 * The PDF of a draft offer as „Als gesendet festhalten“ would store it today,
 * for Admin and Büro of its organization: the same rendering, nothing stored.
 * A sent offer has its filed revisions instead.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await withReadRequest(request, async () =>
      previewResponse(new URL(request.url).searchParams.get('angebot') ?? ''),
    );
  } catch (error) {
    logError('offerPreview: read or render failed', error);
    return Response.json({ error: 'render_failed' }, { status: 500, headers: privateHeaders });
  }
}

async function previewResponse(rawOfferId: string): Promise<Response> {
  const caller = await resolveManagerContext();
  if (!caller.success) {
    const status = caller.error === 'not_authenticated' ? 401 : 403;
    return Response.json({ error: caller.error }, { status, headers: privateHeaders });
  }
  const { context } = caller;
  const offerId = uuidSchema.safeParse(rawOfferId);
  const offer = offerId.success ? await readOffer(context.orgId, offerId.data) : null;
  if (!offer) return Response.json({ error: 'offer_not_found' }, { status: 404, headers: privateHeaders });
  if (offer.status !== 'entwurf') {
    return Response.json({ error: 'offer_not_editable' }, { status: 409, headers: privateHeaders });
  }
  const rendered = await renderOfferPdf(context, offer, getBusinessTodayIso());
  if (!rendered) return Response.json({ error: 'load_failed' }, { status: 500, headers: privateHeaders });
  return new Response(Buffer.from(rendered.bytes), {
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Angebot ${offer.offerNumber} Vorschau.pdf"`,
    },
  });
}
