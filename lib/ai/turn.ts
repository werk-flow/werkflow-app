import 'server-only';

import { createHash } from 'node:crypto';
import { APICallError, type ModelMessage, NoOutputGeneratedError, streamText } from 'ai';

import { AI_MODEL_PRICE, type AiTokenUsage, costMicroUsd } from '@/lib/ai/cost';
import { AI_TURN_LIMITS, type AiEntryPoint, inputTokenCeiling, maxTurnCostMicroUsd } from '@/lib/ai/limits';
import { type AiModel, isAllowedModel, resolveAiModel } from '@/lib/ai/model';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import { isAiReleasedFor } from '@/lib/ai/release-gate';
import { readAiOrganizationSwitch } from '@/lib/ai/settings';
import { AI_TURN_FAILURE_MESSAGES } from '@/lib/ai/turn-messages';
import { logError } from '@/lib/logging';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

// A placeholder until the versioned public prompt (werk-flow/werkflow-planning#529) replaces it.
const AI_SYSTEM_PROMPT = [
  `You are ${AI_PRODUCT_NAME}, the AI assistant inside WerkFlow, the operations app of a German SHK business.`,
  'Answer in natural German and address the user with „du“.',
  'You have no tools yet: you cannot read or change WerkFlow data, send anything or contact anyone; say so when asked.',
  'Never rank or evaluate employees.',
].join(' ');
const AI_PROMPT_VERSION = createHash('sha256').update(AI_SYSTEM_PROMPT).digest('hex').slice(0, 16);

/** How many earlier messages of the thread the model sees, newest first, within the input cap. */
const HISTORY_MESSAGES = 20;
/** Saves of a streaming answer: at most one per interval (brief non-negotiable 4). */
const PARTIAL_SAVE_INTERVAL_MS = 750;
const OPEN_RUN_MINUTES = 15;

export type AiTurnCommand = {
  entryPoint: AiEntryPoint;
  organizationId: string;
  userId: string;
  threadId: string;
  /** The client's idempotency key: a retried command runs at most once and is charged once. */
  commandId: string;
  /** When the request arrived (epoch ms): the turn's total timeout counts from here. */
  receivedAt: number;
  text: string;
};

/** Why a turn did not start. Every code is stable; the client shows its own German text. */
export type AiTurnRefusal =
  | 'not_released'
  | 'disabled'
  | 'unavailable'
  | 'thread_not_found'
  | 'too_many_turns'
  | 'budget_exhausted'
  | 'run_active'
  | 'command_conflict';

/** Why a started turn ended early. The answer keeps what was written and says why. */
export type AiTurnFailure =
  | 'step_limit'
  | 'disabled'
  | 'undecidable'
  | 'input_too_large'
  | 'answer_too_long'
  | 'timeout'
  | 'provider_refused'
  | 'provider_unavailable'
  | 'model_refused'
  | 'interrupted';

export type AiTurnEnd =
  | { status: 'complete' }
  | { status: 'failed' | 'cancelled'; failure: AiTurnFailure; message: string };

/** Receives the answer while it is written. */
export type AiTurnSink = { text: (delta: string) => void };

type ItemRef = { id: string; sequence: number };

export type AiTurnStart =
  | { status: 'refused'; refusal: AiTurnRefusal }
  | { status: 'already_done' }
  | {
      status: 'started';
      userItem: ItemRef;
      assistantItem: ItemRef;
      run: (sink: AiTurnSink) => Promise<AiTurnEnd>;
    };

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Refused = Extract<AiTurnStart, { status: 'refused' }>;
type Reservation =
  | Exclude<AiTurnStart, { status: 'started' }>
  | { status: 'reserved'; runId: string; runKey: string };

const refused = (refusal: AiTurnRefusal): Refused => ({ status: 'refused', refusal });

const messageBodySchema = z.object({ text: z.string() });
const AI_TURN_FAILURE_BODY: { text: string; failure: AiTurnFailure } = { text: '', failure: 'interrupted' };

/**
 * Starts one turn: the thread is the caller's, the per-person limits allow
 * it, the organization's budget holds the turn's most expensive outcome, and
 * no other run of the person is open. Then the user's message and an empty
 * answer are saved. `run` writes the answer; it finishes when the client
 * leaves, so the caller keeps the invocation alive until it settles.
 */
export async function startAiTurn(command: AiTurnCommand): Promise<AiTurnStart> {
  const { organizationId, userId, commandId } = command;
  if (!isAiReleasedFor(organizationId)) return refused('not_released');
  const model = resolveAiModel();
  if (model === 'unavailable') return refused('unavailable');
  const admin = createSupabaseAdminClient();

  // A limiter that cannot decide refuses (lib/security/rate-limit.ts).
  const limit = await consumeRateLimit(
    { action: 'ai_turn_per_user_hour', subject: userId },
    { action: 'ai_turn_per_user_day', subject: userId },
  );
  if (limit === 'limited') return refused('too_many_turns');
  if (limit === 'unavailable') return refused('unavailable');

  const thread = await admin.rpc('create_ai_thread', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_thread_id: command.threadId,
    p_title: threadTitle(command.text),
  });
  if (thread.error) {
    if (thread.error.message === 'ai_thread_not_found') return refused('thread_not_found');
    logError('startAiTurn: thread write failed', thread.error);
    return refused('unavailable');
  }
  // The person's message stands on its own: a refused or failed turn keeps it, and a retry finds it.
  const userItem = await appendItem(
    admin,
    command,
    'user_message',
    'complete',
    { text: command.text },
    `${commandId}:user`,
  );
  if (!userItem) return refused('unavailable');
  // A command id names one message: sent again with other text, it is refused,
  // so the model never answers a message the thread does not hold (sol-loop S17).
  const saved = await readItem(admin, command, `${commandId}:user`);
  if (!saved || saved === 'load_failed') return refused('unavailable');
  if (saved.text !== command.text) return refused('command_conflict');

  const reserved = await reserveRun(admin, command, commandId);
  if (reserved.status !== 'reserved') return reserved;
  const { runId, runKey } = reserved;
  // Refused before its answer exists, the command stays open: a retry under
  // the same id reserves again (resumeClosedCommand).
  const refuse = async (refusal: AiTurnRefusal): Promise<AiTurnStart> => {
    await settleRun(admin, organizationId, runId, 'cancelled');
    return refused(refusal);
  };
  // One active run per person: a run that sees another open run of its person
  // yields. Both reservations are committed before either looks, so two runs
  // never both pass; under a tie both yield, and the client sends again.
  const other = await hasOtherOpenRun(admin, command, runId);
  if (other !== false) return refuse(other === true ? 'run_active' : 'unavailable');

  const history = await readHistory(admin, command, userItem.sequence);
  if (history === 'load_failed') return refuse('unavailable');
  const assistantItem = await appendItem(
    admin,
    command,
    'assistant_message',
    'streaming',
    { text: '' },
    `${commandId}:assistant`,
  );
  if (!assistantItem) return refuse('unavailable');

  const messages = fitInputCap(history, { role: 'user', content: command.text }, command.entryPoint);
  return {
    status: 'started',
    userItem,
    assistantItem,
    run: (sink) => runTurn({ admin, command, model, runId, runKey, assistantItem, messages, sink }),
  };
}

/**
 * Holds the turn's most expensive outcome in the organization's budget under
 * the run's key: the command id, never a value of its message. Its caller has
 * counted the turn against the person's limits.
 */
async function reserveRun(admin: Admin, command: AiTurnCommand, runKey: string): Promise<Reservation> {
  const reservation = await admin
    .rpc('reserve_ai_run', {
      p_organization_id: command.organizationId,
      p_user_id: command.userId,
      p_thread_id: command.threadId,
      p_idempotency_key: runKey,
      p_reserve_micro_usd: maxTurnCostMicroUsd(command.entryPoint),
    })
    .single();
  if (reservation.error) {
    // Only the command's first run resumes; a closed later run is a race with a retry of the same command.
    if (reservation.error.message === 'ai_run_closed' && runKey === command.commandId) {
      return resumeClosedCommand(admin, command);
    }
    logError('startAiTurn: reservation failed', reservation.error);
    return refused('unavailable');
  }
  const reserved = reservation.data;
  if (reserved.verdict === 'disabled') return refused('disabled');
  if (reserved.verdict === 'budget_exhausted') return refused('budget_exhausted');
  // The same command is running in another request.
  if (reserved.verdict === 'replayed') return refused('run_active');
  if (reserved.verdict !== 'reserved') {
    logError('startAiTurn: unexpected reservation verdict', 'invalid_result');
    return refused('unavailable');
  }
  return { status: 'reserved', runId: reserved.run_id, runKey };
}

/**
 * A command whose run closed. With an answer it is done; an answer left
 * streaming is finished as failed and keeps what was written. Refused before
 * its answer existed, it is still open and reserves again, keyed by the
 * command id and the count of its earlier runs.
 */
async function resumeClosedCommand(admin: Admin, command: AiTurnCommand): Promise<Reservation> {
  // The answer first: a run that wrote one was reserved before it, so the run read below sees it.
  const answer = await readItem(admin, command, `${command.commandId}:assistant`);
  if (answer === 'load_failed') return refused('unavailable');
  const runs = await admin
    .from('ai_runs')
    .select('status, created_at')
    .eq('organization_id', command.organizationId)
    .like('idempotency_key', `${command.commandId}%`);
  if (runs.error) {
    logError('startAiTurn: command runs read failed', runs.error);
    return refused('unavailable');
  }
  const openSince = Date.now() - OPEN_RUN_MINUTES * 60_000;
  if (runs.data.some((run) => run.status === 'reserved' && Date.parse(run.created_at) > openSince)) {
    return refused('run_active');
  }
  if (!answer) return reserveRun(admin, command, `${command.commandId}:retry-${runs.data.length}`);
  if (answer.status !== 'streaming') return { status: 'already_done' };
  const finished = await saveAnswer(admin, command, answer.id, 'failed', {
    ...AI_TURN_FAILURE_BODY,
    text: answer.text,
  });
  return finished ? { status: 'already_done' } : refused('unavailable');
}

/** A saved item of the command, by its key. */
async function readItem(
  admin: Admin,
  command: AiTurnCommand,
  idempotencyKey: string,
): Promise<{ id: string; status: string; text: string } | null | 'load_failed'> {
  const { data, error } = await admin
    .from('ai_thread_items')
    .select('id, status, body')
    .eq('organization_id', command.organizationId)
    .eq('thread_id', command.threadId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) {
    logError('startAiTurn: item read failed', error);
    return 'load_failed';
  }
  if (!data) return null;
  const body = messageBodySchema.safeParse(data.body);
  return { id: data.id, status: data.status, text: body.success ? body.data.text : '' };
}

/** The newest history that fits the input cap beside the new message; older messages drop first. */
function fitInputCap(
  history: ModelMessage[],
  message: ModelMessage,
  entryPoint: AiEntryPoint,
): ModelMessage[] {
  const cap = AI_TURN_LIMITS[entryPoint].maxInputTokens;
  let kept = history;
  while (kept.length > 0 && inputTokenCeiling(JSON.stringify([AI_SYSTEM_PROMPT, kept, message])) > cap) {
    kept = kept.slice(1);
  }
  return [...kept, message];
}

function threadTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  return firstLine.slice(0, 80) || AI_PRODUCT_NAME;
}

async function settleRun(
  admin: Admin,
  organizationId: string,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
): Promise<void> {
  const { error } = await admin.rpc('settle_ai_run', {
    p_organization_id: organizationId,
    p_run_id: runId,
    p_status: status,
  });
  // The hold lapses after OPEN_RUN_MINUTES; the recorded attempts stay counted.
  if (error) logError('aiTurn: settlement failed', error);
}

async function hasOtherOpenRun(
  admin: Admin,
  command: AiTurnCommand,
  runId: string,
): Promise<boolean | 'load_failed'> {
  const since = new Date(Date.now() - OPEN_RUN_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from('ai_runs')
    .select('id')
    .eq('organization_id', command.organizationId)
    .eq('user_id', command.userId)
    .eq('status', 'reserved')
    .gt('created_at', since)
    .neq('id', runId)
    .limit(1);
  if (error) {
    logError('startAiTurn: open-run read failed', error);
    return 'load_failed';
  }
  return data.length > 0;
}

/** The thread's latest finished messages, oldest first: the model's memory of the conversation. */
async function readHistory(
  admin: Admin,
  command: AiTurnCommand,
  beforeSequence: number,
): Promise<ModelMessage[] | 'load_failed'> {
  const { data, error } = await admin
    .from('ai_thread_items')
    .select('kind, body, sequence')
    .eq('organization_id', command.organizationId)
    .eq('thread_id', command.threadId)
    .eq('status', 'complete')
    .in('kind', ['user_message', 'assistant_message'])
    .lt('sequence', beforeSequence)
    .order('sequence', { ascending: false })
    .limit(HISTORY_MESSAGES);
  if (error) {
    logError('startAiTurn: history read failed', error);
    return 'load_failed';
  }
  return data
    .toSorted((left, right) => left.sequence - right.sequence)
    .flatMap((item): ModelMessage[] => {
      const body = messageBodySchema.safeParse(item.body);
      if (!body.success || !body.data.text) return [];
      return [{ role: item.kind === 'user_message' ? 'user' : 'assistant', content: body.data.text }];
    });
}

async function appendItem(
  admin: Admin,
  command: AiTurnCommand,
  kind: 'user_message' | 'assistant_message',
  status: 'complete' | 'streaming' | 'failed',
  body: { text: string; failure?: AiTurnFailure },
  idempotencyKey: string,
): Promise<ItemRef | null> {
  const { data, error } = await admin
    .rpc('append_ai_thread_item', {
      p_organization_id: command.organizationId,
      p_user_id: command.userId,
      p_thread_id: command.threadId,
      p_kind: kind,
      p_status: status,
      p_body: body,
      p_idempotency_key: idempotencyKey,
    })
    .single();
  const item = data;
  if (error || !item) {
    logError('startAiTurn: item write failed', error ?? 'no_result');
    return null;
  }
  return { id: item.item_id, sequence: item.item_sequence };
}

type RunContext = {
  admin: Admin;
  command: AiTurnCommand;
  model: AiModel;
  runId: string;
  /** The run's ledger key; each attempt's key extends it. */
  runKey: string;
  assistantItem: ItemRef;
  messages: ModelMessage[];
  sink: AiTurnSink;
};

/** The run's answer so far, with what is left of its one retry allowance. */
type Answer = {
  text: string;
  savedText: string;
  savedAt: number;
  /** The partial save in flight: at most one, never awaited by the stream. */
  saving: Promise<void> | null;
  ledgerFailed: boolean;
  retriesLeft: number;
};

type StepOutcome =
  | { kind: 'finished'; finishReason: string; responseMessages: ModelMessage[] }
  | { kind: 'failed'; failure: AiTurnFailure };

async function runTurn(context: RunContext): Promise<AiTurnEnd> {
  const { admin, command, runId, assistantItem } = context;
  const answer: Answer = {
    text: '',
    savedText: '',
    savedAt: Date.now(),
    saving: null,
    ledgerFailed: false,
    retriesLeft: AI_TURN_LIMITS[command.entryPoint].maxRetries,
  };
  let end: AiTurnEnd;
  try {
    end = await runSteps(context, answer);
  } catch (error) {
    logError('aiTurn: run failed', error instanceof Error ? error.name : 'unknown');
    end = failedEnd('failed', 'interrupted');
  }
  const body =
    end.status === 'complete' ? { text: answer.text } : { text: answer.text, failure: end.failure };
  await answer.saving;
  if (!(await saveAnswer(admin, command, assistantItem.id, end.status, body))) {
    end = failedEnd('failed', 'interrupted');
  }
  // An attempt the ledger could not take keeps its hold until it lapses, so the budget still covers it.
  if (!answer.ledgerFailed) {
    await settleRun(
      admin,
      command.organizationId,
      runId,
      end.status === 'complete' ? 'succeeded' : end.status,
    );
  }
  return end;
}

/** Writes an answer's end; a second try covers a passing database failure. */
async function saveAnswer(
  admin: Admin,
  command: AiTurnCommand,
  itemId: string,
  status: 'complete' | 'failed' | 'cancelled',
  body: { text: string; failure?: AiTurnFailure },
): Promise<boolean> {
  let failure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await admin.rpc('update_ai_thread_item', {
      p_organization_id: command.organizationId,
      p_user_id: command.userId,
      p_item_id: itemId,
      p_status: status,
      p_body: body,
    });
    if (!error) return true;
    failure = error;
  }
  logError('aiTurn: answer save failed', failure);
  return false;
}

function failedEnd(status: 'failed' | 'cancelled', failure: AiTurnFailure): AiTurnEnd {
  return { status, failure, message: AI_TURN_FAILURE_MESSAGES[failure] };
}

/** Whether the organization may take another model step. A read that cannot decide refuses (B14). */
async function readStepGate(organizationId: string): Promise<'open' | 'disabled' | 'undecidable'> {
  try {
    const gate = await readAiOrganizationSwitch(organizationId);
    if (gate === 'load_failed') return 'undecidable';
    return gate.released && gate.enabled ? 'open' : 'disabled';
  } catch (error) {
    logError('aiTurn: switch read failed', error);
    return 'undecidable';
  }
}

async function runSteps(context: RunContext, answer: Answer): Promise<AiTurnEnd> {
  const limits = AI_TURN_LIMITS[context.command.entryPoint];
  // The turn's time counts from the request's arrival, so setup cannot eat the time to settle.
  const elapsedMs = Date.now() - context.command.receivedAt;
  const turnSignal = AbortSignal.timeout(Math.max(0, limits.totalTimeoutMs - elapsedMs));
  let messages = context.messages;
  for (let step = 1; ; step += 1) {
    if (step > limits.maxSteps) return failedEnd('cancelled', 'step_limit');
    const gate = await readStepGate(context.command.organizationId);
    if (gate === 'disabled') return failedEnd('cancelled', 'disabled');
    if (gate === 'undecidable') return failedEnd('cancelled', 'undecidable');
    if (!isAllowedModel(context.model)) return failedEnd('failed', 'provider_refused');
    const prompt = JSON.stringify([AI_SYSTEM_PROMPT, messages]);
    if (inputTokenCeiling(prompt) > limits.maxInputTokens) return failedEnd('failed', 'input_too_large');

    const outcome = await runStep(context, answer, { step, messages, prompt, turnSignal });
    if (outcome.kind === 'failed') {
      const stopped = outcome.failure === 'timeout' || outcome.failure === 'answer_too_long';
      return failedEnd(stopped ? 'cancelled' : 'failed', outcome.failure);
    }
    if (outcome.finishReason === 'length') return failedEnd('cancelled', 'answer_too_long');
    if (outcome.finishReason === 'content-filter') return failedEnd('failed', 'model_refused');
    // A step that ends in tool calls continues; no tool exists yet, so the SDK answers each call with an error.
    if (outcome.finishReason !== 'tool-calls') return { status: 'complete' };
    messages = [...messages, ...outcome.responseMessages];
  }
}

type AttemptResult =
  | { ok: true; finishReason: string; responseMessages: ModelMessage[]; usage: AiTokenUsage }
  | { ok: false; error: unknown; usage: AiTokenUsage | null; started: boolean };

/** A step the harness ends itself: the answer reached its cap, or the stream ended without finishing. */
class TurnStop extends Error {
  constructor(readonly reason: 'answer_too_long' | 'interrupted') {
    super(reason);
    this.name = 'TurnStop';
  }
}

async function runStep(
  context: RunContext,
  answer: Answer,
  step: { step: number; messages: ModelMessage[]; prompt: string; turnSignal: AbortSignal },
): Promise<StepOutcome> {
  const limits = AI_TURN_LIMITS[context.command.entryPoint];
  for (let attempt = 0; ; attempt += 1) {
    const textBefore = answer.text.length;
    const result = await runAttempt(context, answer, step);
    const written = answer.text.length > textBefore;
    const classified = result.ok ? null : classifyAttemptFailure(result.error);
    const outcome = result.ok
      ? result.finishReason === 'tool-calls'
        ? 'tool_calls'
        : 'completed'
      : (classified?.outcome ?? 'provider_error');
    const provider = result.ok ? null : providerFailure(result.error);
    // A failure under a success status came after the provider accepted the request, so it bills it.
    const billed =
      !result.ok && (result.started || (provider?.status !== undefined && provider.status < 400));
    // Every attempt is ledgered at its cost before anything else, so a retry never goes uncounted (B15).
    const usage = result.ok ? result.usage : (result.usage ?? estimatedUsage(step.prompt, billed, limits));
    const key = `${context.runKey}:${step.step}:${attempt}`;
    if (!(await recordAttempt(context, key, usage, outcome))) {
      answer.ledgerFailed = true;
      return { kind: 'failed', failure: 'interrupted' };
    }
    if (result.ok) {
      return {
        kind: 'finished',
        finishReason: result.finishReason,
        responseMessages: result.responseMessages,
      };
    }
    const { failure, retryable } = classified ?? { failure: 'interrupted', retryable: false };
    // What the user already saw is never written twice: a stream that broke after it wrote is not retried.
    if (!retryable || written || answer.retriesLeft <= 0) {
      // Only the harness's own classification reaches the log, never a field the provider sent (B17).
      const status = provider?.status;
      logError('aiTurn: provider attempt failed', status === undefined ? outcome : `${outcome}_${status}`);
      return { kind: 'failed', failure };
    }
    answer.retriesLeft -= 1;
    const gate = await readStepGate(context.command.organizationId);
    if (gate !== 'open') return { kind: 'failed', failure: gate === 'disabled' ? 'disabled' : 'undecidable' };
  }
}

/** The answer's stored size: its JSON with the longest failure code, under the item body cap. */
function storedAnswerBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify({ text, failure: 'provider_unavailable' }), 'utf8');
}

async function runAttempt(
  context: RunContext,
  answer: Answer,
  step: { messages: ModelMessage[]; turnSignal: AbortSignal },
): Promise<AttemptResult> {
  const limits = AI_TURN_LIMITS[context.command.entryPoint];
  // Stopping early also stops the provider's request, so it generates nothing more.
  const attemptAbort = new AbortController();
  const result = streamText({
    model: context.model,
    instructions: AI_SYSTEM_PROMPT,
    messages: step.messages,
    maxOutputTokens: limits.maxOutputTokens,
    // The harness retries, so it can ledger each attempt and never retry a spend limit.
    maxRetries: 0,
    abortSignal: AbortSignal.any([step.turnSignal, attemptAbort.signal]),
    timeout: { stepMs: limits.stepTimeoutMs, chunkMs: limits.chunkTimeoutMs },
    providerOptions: { anthropic: { thinking: { type: 'adaptive' }, effort: limits.effort } },
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    // The default handler prints the provider's error, body included; the loop below reads it instead.
    onError: () => undefined,
  });
  let usage: AiTokenUsage | null = null;
  let finishReason = 'other';
  // Whether the provider began generating: from then on the attempt is billed.
  let started = false;
  const fail = (error: unknown): AttemptResult => {
    attemptAbort.abort();
    return { ok: false, error, usage, started };
  };
  try {
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        started = true;
        // The cap holds before a delta is shown or saved; the rest of the answer is dropped.
        if (storedAnswerBytes(answer.text + part.text) > limits.maxAnswerBytes)
          return fail(new TurnStop('answer_too_long'));
        answer.text += part.text;
        context.sink.text(part.text);
        savePartial(context, answer);
      } else if (part.type === 'start-step') {
        // The provider accepted the request: from here on it bills the prompt.
        started = true;
      } else if (part.type === 'finish-step') {
        usage = tokenUsage(part.usage);
        finishReason = part.finishReason;
      } else if (part.type === 'error') {
        return fail(part.error);
      } else if (part.type === 'abort') {
        return fail(new DOMException('aborted', 'AbortError'));
      }
    }
    // The provider's stream ended without its final event: what it wrote may be cut, its usage unknown.
    if (finishReason === 'interrupted') return fail(new TurnStop('interrupted'));
    const response = await result.response;
    return {
      ok: true,
      finishReason,
      responseMessages: response.messages,
      usage: usage ?? estimatedUsage(JSON.stringify([AI_SYSTEM_PROMPT, step.messages]), true, limits),
    };
  } catch (error) {
    return fail(error);
  }
}

/** Saves the partial answer at most every PARTIAL_SAVE_INTERVAL_MS, so a reload or a second device shows it. */
function savePartial(context: RunContext, answer: Answer): void {
  const now = Date.now();
  if (answer.saving || now - answer.savedAt < PARTIAL_SAVE_INTERVAL_MS || answer.text === answer.savedText)
    return;
  answer.savedAt = now;
  answer.savedText = answer.text;
  // The model's stream never waits for the database; the final save waits for this one.
  answer.saving = (async () => {
    const { error } = await context.admin.rpc('update_ai_thread_item', {
      p_organization_id: context.command.organizationId,
      p_user_id: context.command.userId,
      p_item_id: context.assistantItem.id,
      p_status: 'streaming',
      p_body: { text: answer.savedText },
    });
    // A missed partial save costs only freshness; the final save follows.
    if (error) logError('aiTurn: partial save failed', error);
    answer.saving = null;
  })();
}

type StreamUsage = {
  inputTokens: number | undefined;
  inputTokenDetails: {
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
};

function tokenUsage(usage: StreamUsage): AiTokenUsage | null {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const inputTokens =
    usage.inputTokenDetails.noCacheTokens ??
    Math.max(0, usage.inputTokens - cacheReadTokens - cacheWriteTokens);
  return { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens: usage.outputTokens };
}

/**
 * An attempt the provider reported no usage for. One refused before it began
 * is not billed; one that began, or that the provider accepted, is charged at
 * its caps: the prompt's upper bound and every output token it may have used,
 * so the ledger never undercounts.
 */
function estimatedUsage(prompt: string, billed: boolean, limits: { maxOutputTokens: number }): AiTokenUsage {
  return {
    inputTokens: billed ? inputTokenCeiling(prompt) : 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: billed ? limits.maxOutputTokens : 0,
  };
}

async function recordAttempt(
  context: RunContext,
  key: string,
  usage: AiTokenUsage,
  outcome: string,
): Promise<boolean> {
  // The key makes a repeat charge once; a second try covers a passing database failure.
  for (const last of [false, true]) {
    if (await recordAttemptOnce(context, key, usage, outcome, last)) return true;
  }
  return false;
}

async function recordAttemptOnce(
  context: RunContext,
  key: string,
  usage: AiTokenUsage,
  outcome: string,
  last: boolean,
): Promise<boolean> {
  const { error } = await context.admin.rpc('record_ai_run_attempt', {
    p_organization_id: context.command.organizationId,
    p_run_id: context.runId,
    p_idempotency_key: key,
    p_model_id: context.model.modelId,
    p_prompt_version: AI_PROMPT_VERSION,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cache_read_tokens: usage.cacheReadTokens,
    p_cache_write_tokens: usage.cacheWriteTokens,
    p_cost_micro_usd: costMicroUsd(usage, AI_MODEL_PRICE),
    p_outcome: outcome,
  });
  if (error && last) logError('aiTurn: attempt record failed', error);
  return !error;
}

// Anthropic's codes for a reached spend limit: the workspace's or organization's, and the contract's.
const SPEND_LIMIT_CODES = new Set(['enforced_spend_limit_reached', 'contract_spend_limit_reached']);
const providerStreamErrorSchema = z.object({ statusCode: z.number(), data: z.unknown().optional() });
const spendLimitSchema = z.union([
  z
    .object({ error: z.object({ details: z.object({ error_code: z.string() }) }) })
    .transform((body) => body.error.details.error_code),
  z.object({ details: z.object({ error_code: z.string() }) }).transform((body) => body.details.error_code),
]);

/** Status and body of a provider failure: a refused request, or an error event inside its stream. */
function providerFailure(error: unknown): { status: number | undefined; body: unknown } | null {
  if (APICallError.isInstance(error)) {
    try {
      return { status: error.statusCode, body: error.responseBody ? JSON.parse(error.responseBody) : null };
    } catch {
      return { status: error.statusCode, body: null };
    }
  }
  const streamError = providerStreamErrorSchema.safeParse(error);
  return streamError.success ? { status: streamError.data.statusCode, body: streamError.data.data } : null;
}

/**
 * Sorts a failed attempt. A spend limit (402, or 429 with a spend-limit
 * code) and every other refusal of the request
 * (400 and the rest of 4xx) are never retried; a timeout and a full answer
 * end the turn; overload, a server error, a lost connection and a stream that
 * ended early are retried.
 */
function classifyAttemptFailure(error: unknown): {
  failure: AiTurnFailure;
  retryable: boolean;
  outcome: string;
} {
  if (error instanceof TurnStop) {
    return error.reason === 'answer_too_long'
      ? { failure: 'answer_too_long', retryable: false, outcome: 'answer_too_long' }
      : { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { failure: 'timeout', retryable: false, outcome: 'timeout' };
  }
  // A stream that closed before its first event: retried like one that ended early.
  if (NoOutputGeneratedError.isInstance(error)) {
    return { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  const failure = providerFailure(error);
  if (!failure) return { failure: 'provider_unavailable', retryable: false, outcome: 'provider_error' };
  const { status, body } = failure;
  // No status, or a success status whose stream then broke: the connection failed, not the request.
  if (status === undefined || status < 400) {
    return { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  const spendLimit = spendLimitSchema.safeParse(body);
  if (status === 402 || (status === 429 && spendLimit.success && SPEND_LIMIT_CODES.has(spendLimit.data))) {
    return { failure: 'provider_refused', retryable: false, outcome: 'spend_limit' };
  }
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return { failure: 'provider_unavailable', retryable: true, outcome: 'provider_error' };
  }
  return { failure: 'provider_refused', retryable: false, outcome: 'provider_refused' };
}
