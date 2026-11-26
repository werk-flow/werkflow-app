import { after } from 'next/server';

import { AI_TURN_LIMITS } from '@/lib/ai/limits';
import { type AiTurnRefusal, startAiTurn } from '@/lib/ai/turn';
import { createTurnEventStream } from '@/lib/ai/turn-stream';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The turn's total timeout plus room to save the answer and settle its cost.
export const maxDuration = 150;

const privateHeaders = { 'Cache-Control': 'private, no-store' };

const turnSchema = z.object({
  organizationId: uuidSchema,
  commandId: uuidSchema,
  text: z.string().trim().min(1).max(AI_TURN_LIMITS.chat.maxMessageCharacters),
});

const REFUSAL_STATUS: Readonly<Record<AiTurnRefusal, number>> = {
  not_released: 403,
  disabled: 403,
  thread_not_found: 404,
  run_active: 409,
  command_conflict: 409,
  too_many_turns: 429,
  budget_exhausted: 429,
  unavailable: 503,
};

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: privateHeaders });
}

/**
 * One WerkFlow KI turn in the caller's own thread: saves the message, runs
 * the model and streams the answer as newline-delimited JSON. The run goes on
 * after the client leaves; the saved answer is the record.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const receivedAt = Date.now();
  if (!verifySameOriginJsonRequest(request).allowed) return refuse('forbidden_origin', 403);
  const threadId = uuidSchema.safeParse((await params).threadId);
  const body: unknown = await request.json().catch(() => null);
  const parsed = turnSchema.safeParse(body);
  if (!threadId.success || !parsed.success) return refuse('invalid_input', 400);

  try {
    const auth = await resolveActionContextFor(parsed.data.organizationId);
    if (!auth.success) return refuse(auth.error, auth.error === 'not_authenticated' ? 401 : 403);
    const { userId, orgId } = auth.context;
    const start = await startAiTurn({
      entryPoint: 'chat',
      organizationId: orgId,
      userId,
      threadId: threadId.data,
      commandId: parsed.data.commandId,
      receivedAt,
      text: parsed.data.text,
    });
    if (start.status === 'refused') return refuse(start.refusal, REFUSAL_STATUS[start.refusal]);
    if (start.status === 'already_done')
      return Response.json({ status: 'already_done' }, { headers: privateHeaders });

    const stream = createTurnEventStream();
    stream.send({ type: 'started', userItem: start.userItem, assistantItem: start.assistantItem });
    // The invocation stays alive until the run has saved its answer and settled its cost.
    after(start.run(stream.sink).then(stream.end));
    return new Response(stream.readable, {
      headers: { ...privateHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    });
  } catch (error) {
    logError('aiTurnRoute: turn failed', error);
    return refuse('unavailable', 503);
  }
}
