import { stopAiTurn } from '@/lib/ai/stop';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

const stopSchema = z.object({ organizationId: uuidSchema, commandId: uuidSchema });

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: privateHeaders });
}

/**
 * „Antwort anhalten“: stops the answer to one command in the caller's own
 * thread. The running turn ends at its next save and tells every tab.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  if (!verifySameOriginJsonRequest(request).allowed) return refuse('forbidden_origin', 403);
  const threadId = uuidSchema.safeParse((await params).threadId);
  const body: unknown = await request.json().catch(() => null);
  const parsed = stopSchema.safeParse(body);
  if (!threadId.success || !parsed.success) return refuse('invalid_input', 400);

  try {
    const auth = await resolveActionContextFor(parsed.data.organizationId);
    if (!auth.success) return refuse(auth.error, auth.error === 'not_authenticated' ? 401 : 403);
    const verdict = await stopAiTurn({
      organizationId: auth.context.orgId,
      userId: auth.context.userId,
      threadId: threadId.data,
      commandId: parsed.data.commandId,
    });
    if (verdict === 'thread_not_found') return refuse(verdict, 404);
    if (verdict === 'unavailable') return refuse(verdict, 503);
    return Response.json({ verdict }, { headers: privateHeaders });
  } catch (error) {
    logError('aiStopRoute: stop failed', error);
    return refuse('unavailable', 503);
  }
}
