import 'server-only';

import { type ModelMessage, type ToolSet, streamText } from 'ai';

import { type AiContext, type AiThreadMessage, buildAiContext, serializedInput } from '@/lib/ai/context';
import { AI_MODEL_PRICE, type AiTokenUsage, costMicroUsd } from '@/lib/ai/cost';
import {
  AI_TURN_LIMITS,
  AI_UPLOAD_LIMITS,
  type AiEntryPoint,
  inputTokenCeiling,
  maxTurnCostMicroUsd,
} from '@/lib/ai/limits';
import { type AiModel, isAllowedModel, resolveAiModel } from '@/lib/ai/model';
import {
  TurnStop,
  acceptedByProvider,
  classifyAttemptFailure,
  providerFailure,
} from '@/lib/ai/attempt-failure';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import { AI_PROMPT_VERSION } from '@/lib/ai/prompt/system-prompt';
import { isAiReleasedFor } from '@/lib/ai/release-gate';
import { readAiOrganizationSwitch } from '@/lib/ai/settings';
import { rowFromItem } from '@/lib/ai/thread-rows';
import type { AiThreadRow } from '@/lib/ai/thread-types';
import { toToolSet } from '@/lib/ai/tools/define-tool';
import { aiToolsFor } from '@/lib/ai/tools/registry';
import {
  type ToolCalls,
  newToolCalls,
  recordPendingCalls,
  recordUnrunCalls,
  runTool,
  toolRunFor,
} from '@/lib/ai/tools/tool-calls';
import { boundedWrite } from '@/lib/ai/bounded-write';
import { AI_TURN_FAILURE_MESSAGES } from '@/lib/ai/turn-messages';
import { logError } from '@/lib/logging';
import type { OrgRole } from '@/lib/roles';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

/** How many earlier messages of the thread the model sees, newest first, within the input cap. */
const HISTORY_MESSAGES = 20;
/** A save refused for these says the author lost the thread: the turn ends, and the live channel sends nothing more. */
const LOST_ACCESS = new Set(['ai_actor_without_access', 'ai_thread_not_found', 'ai_thread_item_not_found']);
/** A save refused with this says the person stopped the answer (`cancel_ai_turn`): the turn ends. */
const STOPPED = 'ai_thread_item_stopped';
/** Saves of a streaming answer: at most one per interval (brief non-negotiable 4). */
const PARTIAL_SAVE_INTERVAL_MS = 750;

export type AiTurnCommand = {
  entryPoint: AiEntryPoint;
  organizationId: string;
  userId: string;
  /** The caller's role in the organization, from the server's membership read: it picks the model's tools. */
  role: OrgRole;
  threadId: string;
  /** The client's idempotency key: a retried command runs at most once and is charged once. */
  commandId: string;
  /** When the request arrived (epoch ms): the turn's total timeout counts from here. */
  receivedAt: number;
  text: string;
  /** The person's uploads this message attaches; the model reads one only through a tool's extractor. */
  fileIds?: readonly string[];
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
  | 'command_conflict'
  | 'file_not_found'
  | 'files_over_cap';

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
  | 'interrupted'
  | 'stopped'
  | 'revoked';

export type AiTurnEnd =
  | { status: 'complete' }
  | { status: 'failed' | 'cancelled'; failure: AiTurnFailure; message: string };

/**
 * Receives the answer while it is written. The live channel also hears how
 * much of it each partial save holds, and when a save says the author lost
 * access to the thread.
 */
export type AiTurnSink = {
  text: (delta: string) => void;
  saved?: (length: number) => void;
  revoked?: () => void;
  /** A row of the turn's tool calls, questions or to-do list, each time it is saved (lib/ai/tools/tool-calls.ts). */
  row?: (row: AiThreadRow) => void;
};

type ItemRef = { id: string; sequence: number };

export type AiTurnStart =
  | { status: 'refused'; refusal: AiTurnRefusal }
  | { status: 'already_done' }
  | {
      status: 'started';
      userItem: ItemRef;
      assistantItem: ItemRef;
      /** The message's file items, by file id. */
      files: Array<{ fileId: string; sequence: number }>;
      run: (sink: AiTurnSink) => Promise<AiTurnEnd>;
    };

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Refused = Extract<AiTurnStart, { status: 'refused' }>;

const refused = (refusal: AiTurnRefusal): Refused => ({ status: 'refused', refusal });

const FILE_REFUSALS: Readonly<Record<string, AiTurnRefusal>> = {
  ai_file_not_found: 'file_not_found',
  ai_files_over_turn_cap: 'files_over_cap',
};
const startedFilesSchema = z.object({
  files: z.array(z.object({ fileId: z.string(), sequence: z.number() })).default([]),
});

const messageBodySchema = z.object({ text: z.string() });
// What `start_ai_turn` answers: ids only when the turn started.
const turnStartSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('started'),
    run_id: z.string(),
    user_item_id: z.string(),
    user_item_sequence: z.number(),
    answer_item_id: z.string(),
    answer_item_sequence: z.number(),
  }),
  z.object({
    verdict: z.enum([
      'answered',
      'run_active',
      'replayed',
      'command_conflict',
      'disabled',
      'budget_exhausted',
    ]),
  }),
]);

/**
 * Starts one turn: the per-person limits allow it, then one database call
 * saves the person's message in the caller's thread and, when no other run of
 * the person is open and the organization's budget holds the turn's most
 * expensive outcome, reserves the run and saves an empty answer. A refusal
 * keeps the message. `run` writes the answer and goes on after the client
 * leaves, so the caller keeps the invocation alive until it saved the answer
 * and settled.
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

  // The reservation's key is the command id, never a value of its message (decision 19).
  const args = {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_thread_id: command.threadId,
    p_title: threadTitle(command.text),
    p_command_id: commandId,
    p_text: command.text,
    p_reserve_micro_usd: maxTurnCostMicroUsd(command.entryPoint),
  };
  // The message's files, none included, save in the same call, before it, bound to the command.
  const { data, error } = await admin
    .rpc('start_ai_turn_with_files', {
      ...args,
      p_file_ids: [...(command.fileIds ?? [])],
      p_max_files: AI_UPLOAD_LIMITS.maxFilesPerMessage,
      p_max_bytes: AI_UPLOAD_LIMITS.maxMessageBytes,
    })
    .single();
  if (error) {
    const fileRefusal = FILE_REFUSALS[error.message];
    if (fileRefusal) return refused(fileRefusal);
    if (error.message === 'ai_thread_not_found') return refused('thread_not_found');
    // An earlier build closed this command's run before its answer existed; the client sends a new command.
    if (error.message === 'ai_run_closed') return refused('command_conflict');
    logError('startAiTurn: turn start failed', error);
    return refused('unavailable');
  }
  const start = turnStartSchema.safeParse(data);
  if (!start.success) {
    logError('startAiTurn: unexpected turn start', 'invalid_result');
    return refused('unavailable');
  }
  const started = start.data;
  if (started.verdict === 'answered') return { status: 'already_done' };
  // The same command runs in another request.
  if (started.verdict === 'replayed') return refused('run_active');
  if (started.verdict !== 'started') return refused(started.verdict);
  const userItem = { id: started.user_item_id, sequence: started.user_item_sequence };
  const assistantItem = { id: started.answer_item_id, sequence: started.answer_item_sequence };
  return {
    status: 'started',
    userItem,
    assistantItem,
    files: startedFilesSchema.safeParse(data).data?.files ?? [],
    run: (sink) =>
      runTurn({
        admin,
        command,
        model,
        runId: started.run_id,
        runKey: commandId,
        userItem,
        assistantItem,
        sink,
      }),
  };
}

/** The first line of the first message, up to 80 characters; counted by code point, so none is split. */
function threadTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  return Array.from(firstLine).slice(0, 80).join('') || AI_PRODUCT_NAME;
}

/** A question the agent asked, as the model reads it back: the question and the answers it offered. */
function questionText(item: { kind: string; sequence: number; body: unknown }): string {
  const row = rowFromItem({ ...item, idempotency_key: 'history', status: 'complete' });
  if (row?.role !== 'question') return '';
  return [row.question, ...row.options.map((option) => `- ${option}`)].join('\n');
}

/** The thread's latest finished messages and questions, oldest first: the model's memory of the conversation. */
async function readHistory(
  admin: Admin,
  command: AiTurnCommand,
  beforeSequence: number,
  signal: AbortSignal,
): Promise<AiThreadMessage[] | 'load_failed'> {
  const { data, error } = await admin
    .from('ai_thread_items')
    .select('kind, body, sequence')
    .eq('organization_id', command.organizationId)
    .eq('thread_id', command.threadId)
    .eq('status', 'complete')
    .in('kind', ['user_message', 'assistant_message', 'question'])
    .lt('sequence', beforeSequence)
    .order('sequence', { ascending: false })
    .limit(HISTORY_MESSAGES)
    .abortSignal(signal);
  if (error) {
    logError('aiTurn: history read failed', error);
    return 'load_failed';
  }
  return data
    .toSorted((left, right) => left.sequence - right.sequence)
    .flatMap((item): AiThreadMessage[] => {
      if (item.kind === 'question') {
        const text = questionText(item);
        return text ? [{ role: 'assistant', text }] : [];
      }
      const body = messageBodySchema.safeParse(item.body);
      if (!body.success || !body.data.text) return [];
      return [{ role: item.kind === 'user_message' ? 'user' : 'assistant', text: body.data.text }];
    });
}

/**
 * Ends the run's reservation at the cost the ledger recorded. When it cannot,
 * the reservation stays as the run's provisional charge, and the database job
 * settles it at its reserved amount.
 */
async function settleRun(context: TurnContext, status: 'succeeded' | 'failed' | 'cancelled'): Promise<void> {
  await boundedWrite(
    'aiTurn: settlement failed',
    AI_TURN_LIMITS[context.command.entryPoint].settleTimeoutMs,
    2,
    (signal) =>
      context.admin
        .rpc('settle_ai_run', {
          p_organization_id: context.command.organizationId,
          p_run_id: context.runId,
          p_status: status,
        })
        .abortSignal(signal),
  );
}

/** What a started turn knows before it reads the thread. */
type TurnContext = {
  admin: Admin;
  command: AiTurnCommand;
  model: AiModel;
  runId: string;
  /** The run's ledger key; each attempt's key extends it. */
  runKey: string;
  userItem: ItemRef;
  assistantItem: ItemRef;
  sink: AiTurnSink;
};

type RunContext = TurnContext & {
  /** What the model reads: the system prompt, the role's tools and the thread (lib/ai/context.ts). */
  modelContext: AiContext;
  /** Aborts when the turn's total time is up, counted from the request's arrival. */
  turnSignal: AbortSignal;
  toolCalls: ToolCalls;
};

/** Why the turn ends at once: the person stopped the answer, or a save said they lost the thread. */
type Halt = 'stopped' | 'revoked';

/** The run's answer so far, with what is left of its one retry allowance. */
type Answer = {
  text: string;
  savedText: string;
  savedAt: number;
  /** The partial save in flight: at most one, never awaited by the stream. */
  saving: Promise<void> | null;
  ledgerFailed: boolean;
  retriesLeft: number;
  halted: Halt | null;
  /** Aborts the provider request when the turn halts. */
  halt: AbortController;
};

type StepOutcome =
  | { kind: 'finished'; finishReason: string; responseMessages: ModelMessage[] }
  | { kind: 'failed'; failure: AiTurnFailure };

async function runTurn(context: TurnContext): Promise<AiTurnEnd> {
  const { command } = context;
  const limits = AI_TURN_LIMITS[command.entryPoint];
  const answer: Answer = {
    text: '',
    savedText: '',
    savedAt: Date.now(),
    saving: null,
    ledgerFailed: false,
    retriesLeft: limits.maxRetries,
    halted: null,
    halt: new AbortController(),
  };
  // The turn's time counts from the request's arrival, so setup cannot eat the time to settle.
  const turnSignal = AbortSignal.timeout(
    Math.max(0, limits.totalTimeoutMs - (Date.now() - command.receivedAt)),
  );
  let end: AiTurnEnd;
  const toolCalls = newToolCalls();
  try {
    const history = await readHistory(context.admin, command, context.userItem.sequence, turnSignal);
    if (history === 'load_failed') {
      end = turnSignal.aborted ? failedEnd('cancelled', 'timeout') : failedEnd('failed', 'interrupted');
    } else {
      const modelContext = await buildAiContext({
        tools: aiToolsFor(command.role),
        thread: [...history, { role: 'user', text: command.text }],
        // The thread leaves room for the turn's tool results, which share their own cap.
        inputTokenCap: limits.maxInputTokens - limits.maxToolResultBytes,
      });
      end = await runSteps({ ...context, modelContext, turnSignal, toolCalls }, answer);
    }
  } catch (error) {
    logError('aiTurn: run failed', error instanceof Error ? error.name : 'unknown');
    end = failedEnd('failed', 'interrupted');
  }
  // A tool's model call still running when the turn ended is aborted with it and ledgered before the run settles.
  await Promise.allSettled(toolCalls.runningModelCalls);
  // A tool still running when the turn ended gets its ledger row before the run settles (B19).
  await recordPendingCalls({ ...context, toolCalls });
  const body =
    end.status === 'complete' ? { text: answer.text } : { text: answer.text, failure: end.failure };
  await answer.saving;
  // An author who lost the thread gets no final write: it would only be refused again.
  const saved = answer.halted !== 'revoked' && (await saveAnswer(context, answer, end.status, body));
  // A stop that landed after the last partial save is first seen by the final save, which it refused.
  if (answer.halted) end = failedEnd('cancelled', answer.halted);
  else if (!saved) end = failedEnd('failed', 'interrupted');
  // An attempt the ledger could not take leaves the run open: its reservation stays as the provisional charge.
  // Every other run settles at its recorded cost, a failed final save included, so the person's next turn may start.
  if (!answer.ledgerFailed && !toolCalls.costUnrecorded)
    await settleRun(context, end.status === 'complete' ? 'succeeded' : end.status);
  return end;
}

/**
 * Writes an answer's end, trying again within its time limit. An answer
 * already finished counts as saved: while the run is open, only the run and
 * the person's stop finish its answer, and a stopped one refuses as stopped,
 * so a plain refusal says an earlier try landed. A stop or a lost thread ends
 * the tries and halts the turn. Left streaming, the answer keeps its last
 * partial save, and the database job finishes it.
 */
async function saveAnswer(
  context: TurnContext,
  answer: Answer,
  status: 'complete' | 'failed' | 'cancelled',
  body: { text: string; failure?: AiTurnFailure },
): Promise<boolean> {
  return boundedWrite(
    'aiTurn: answer save failed',
    AI_TURN_LIMITS[context.command.entryPoint].answerSaveTimeoutMs,
    3,
    (signal) =>
      context.admin
        .rpc('update_ai_thread_item', {
          p_organization_id: context.command.organizationId,
          p_user_id: context.command.userId,
          p_item_id: context.assistantItem.id,
          p_status: status,
          p_body: body,
        })
        .abortSignal(signal),
    (message) => {
      haltOnRefusal(context, answer, message);
      // A stop or a lost thread is final: no try changes it.
      return message === 'ai_thread_item_finished' || message === STOPPED || LOST_ACCESS.has(message);
    },
  );
}

/**
 * Ends the turn at once when a save says the person stopped the answer or
 * lost the thread: the provider request aborts, and a lost thread's live
 * channel sends nothing more.
 */
function haltOnRefusal(context: TurnContext, answer: Answer, message: string): void {
  const halt: Halt | null = message === STOPPED ? 'stopped' : LOST_ACCESS.has(message) ? 'revoked' : null;
  if (!halt) return;
  if (halt === 'revoked') context.sink.revoked?.();
  answer.halted ??= halt;
  answer.halt.abort();
}

function failedEnd(status: 'failed' | 'cancelled', failure: AiTurnFailure): AiTurnEnd {
  return { status, failure, message: AI_TURN_FAILURE_MESSAGES[failure] };
}

/**
 * Whether the answer is still being written: only the person's stop finishes
 * it while its run is open. The database rechecks the author's effective access.
 */
async function readAnswerOpen(context: RunContext): Promise<'open' | Halt | 'load_failed'> {
  const { data, error } = await context.admin.rpc('read_ai_answer_status', {
    p_organization_id: context.command.organizationId,
    p_user_id: context.command.userId,
    p_item_id: context.assistantItem.id,
  });
  if (error) {
    if (LOST_ACCESS.has(error.message)) return 'revoked';
    logError('aiTurn: answer read failed', error);
    return 'load_failed';
  }
  if (!data) return 'load_failed';
  return data === 'streaming' ? 'open' : 'stopped';
}

/**
 * Whether the turn may take another model step: the organization's switch
 * and the person's stop are read again. A read that cannot decide refuses
 * (B14); one still running when the turn's time is up ends the turn, so the
 * invocation keeps its time to save and settle.
 */
async function readStepGate(
  context: RunContext,
  answer: Answer,
  turnSignal: AbortSignal,
): Promise<'open' | 'disabled' | 'undecidable' | 'timeout' | Halt> {
  if (answer.halted) return answer.halted;
  const timeUp = new Promise<'timeout'>((resolve) => {
    if (turnSignal.aborted) resolve('timeout');
    else turnSignal.addEventListener('abort', () => resolve('timeout'), { once: true });
  });
  try {
    const reads = Promise.all([
      readAiOrganizationSwitch(context.command.organizationId),
      readAnswerOpen(context),
    ]);
    const gate = await Promise.race([reads, timeUp]);
    if (gate === 'timeout') return 'timeout';
    const [organization, open] = gate;
    if (organization === 'load_failed' || open === 'load_failed') return 'undecidable';
    if (!organization.released || !organization.enabled) return 'disabled';
    if (open !== 'open') {
      answer.halted ??= open;
      if (open === 'revoked') context.sink.revoked?.();
    }
    return answer.halted ?? 'open';
  } catch (error) {
    logError('aiTurn: switch read failed', error);
    return 'undecidable';
  }
}

async function runSteps(context: RunContext, answer: Answer): Promise<AiTurnEnd> {
  const limits = AI_TURN_LIMITS[context.command.entryPoint];
  let messages = context.modelContext.messages;
  for (let step = 1; ; step += 1) {
    if (step > limits.maxSteps) return failedEnd('cancelled', 'step_limit');
    const gate = await readStepGate(context, answer, context.turnSignal);
    if (gate !== 'open') return failedEnd('cancelled', gate);
    if (!isAllowedModel(context.model)) return failedEnd('failed', 'provider_refused');
    const prompt = serializedInput(context.modelContext, messages);
    if (inputTokenCeiling(prompt) > limits.maxInputTokens) return failedEnd('failed', 'input_too_large');

    const outcome = await runStep(context, answer, {
      step,
      messages,
      prompt,
      turnSignal: context.turnSignal,
    });
    if (outcome.kind === 'failed') {
      const stopped = ['timeout', 'answer_too_long', 'stopped', 'revoked'].includes(outcome.failure);
      return failedEnd(stopped ? 'cancelled' : 'failed', outcome.failure);
    }
    if (outcome.finishReason === 'length') return failedEnd('cancelled', 'answer_too_long');
    if (outcome.finishReason === 'content-filter') return failedEnd('failed', 'model_refused');
    // A step that ends in tool calls continues with their results; one that asked the person waits for them.
    if (outcome.finishReason !== 'tool-calls' || context.toolCalls.asked) return { status: 'complete' };
    messages = [...messages, ...outcome.responseMessages];
  }
}

type AttemptResult =
  | { ok: true; finishReason: string; responseMessages: ModelMessage[]; usage: AiTokenUsage }
  | { ok: false; error: unknown; usage: AiTokenUsage | null; started: boolean };

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
    // A halted attempt is ledgered as what ended it, at its caps unless the provider reported its usage.
    const outcome =
      answer.halted ??
      (result.ok
        ? result.finishReason === 'tool-calls'
          ? 'tool_calls'
          : 'completed'
        : (classified?.outcome ?? 'provider_error'));
    const provider = result.ok ? null : providerFailure(result.error);
    const billed = !result.ok && (result.started || acceptedByProvider(result.error));
    // Every attempt is ledgered at its cost before anything else, so a retry never goes uncounted (B15).
    const usage = result.ok ? result.usage : (result.usage ?? estimatedUsage(step.prompt, billed, limits));
    const key = `${context.runKey}:${step.step}:${attempt}`;
    const costRecorded = await recordAttempt(context, key, usage, outcome);
    // Every call the attempt emitted is recorded before its outcome counts or a retry starts (B19),
    // also when its cost row failed and the run keeps its provisional charge.
    await recordUnrunCalls(context);
    if (!costRecorded) answer.ledgerFailed = true;
    if (!costRecorded || context.toolCalls.unrecorded) return { kind: 'failed', failure: 'interrupted' };
    // A call whose tool still runs when the turn halts is recorded before the run settles (runTurn).
    if (answer.halted) return { kind: 'failed', failure: answer.halted };
    if (result.ok) {
      return {
        kind: 'finished',
        finishReason: result.finishReason,
        responseMessages: result.responseMessages,
      };
    }
    const { failure, retryable } = classified ?? { failure: 'interrupted', retryable: false };
    // What the user already saw is never written twice: a stream that broke after it wrote, or after
    // it asked the person a question, is not retried.
    if (!retryable || written || context.toolCalls.asked || answer.retriesLeft <= 0) {
      // Only the harness's own classification reaches the log, never a field the provider sent (B17).
      const status = provider?.status;
      logError('aiTurn: provider attempt failed', status === undefined ? outcome : `${outcome}_${status}`);
      return { kind: 'failed', failure };
    }
    answer.retriesLeft -= 1;
    const gate = await readStepGate(context, answer, step.turnSignal);
    if (gate !== 'open') return { kind: 'failed', failure: gate };
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
    instructions: context.modelContext.instructions,
    tools: prepareStep(context, answer),
    // One call at a time, so none starts after another's ledger row failed.
    toolCallConcurrency: 1,
    messages: step.messages,
    maxOutputTokens: limits.maxOutputTokens,
    // The harness retries, so it can ledger each attempt and never retry a spend limit.
    maxRetries: 0,
    abortSignal: AbortSignal.any([step.turnSignal, attemptAbort.signal, answer.halt.signal]),
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
      } else if (part.type === 'tool-call') {
        context.toolCalls.seen.set(part.toolCallId, part.toolName);
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
      // Every part may save, thinking included, so a stop or a lost thread shows within one save interval.
      savePartial(context, answer);
    }
    // The provider's stream ended without its final event: what it wrote may be cut, its usage unknown.
    if (finishReason === 'interrupted') return fail(new TurnStop('interrupted'));
    const response = await result.response;
    return {
      ok: true,
      finishReason,
      responseMessages: response.messages,
      usage: usage ?? estimatedUsage(serializedInput(context.modelContext, step.messages), true, limits),
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Saves the partial answer at most every PARTIAL_SAVE_INTERVAL_MS, so a reload or a second device shows it.
 * A save of unchanged text while the model thinks is how the turn learns of a stop in time.
 */
function savePartial(context: RunContext, answer: Answer): void {
  const now = Date.now();
  if (answer.saving || answer.halted || now - answer.savedAt < PARTIAL_SAVE_INTERVAL_MS) return;
  answer.savedAt = now;
  answer.savedText = answer.text;
  // The model's stream never waits for the database; the final save waits for this one.
  answer.saving = (async () => {
    const { error } = await context.admin
      .rpc('update_ai_thread_item', {
        p_organization_id: context.command.organizationId,
        p_user_id: context.command.userId,
        p_item_id: context.assistantItem.id,
        p_status: 'streaming',
        p_body: { text: answer.savedText },
      })
      .abortSignal(AbortSignal.timeout(AI_TURN_LIMITS[context.command.entryPoint].answerSaveTimeoutMs));
    // A missed partial save costs only freshness; the final save follows.
    if (!error) context.sink.saved?.(answer.savedText.length);
    else if (error.message !== STOPPED) logError('aiTurn: partial save failed', error);
    if (error) haltOnRefusal(context, answer, error.message);
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
 * An attempt the provider reported no usage for. One it refused with an error
 * status is not billed; any other, which it may have accepted, is charged at
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

/** Ledgers one attempt under its time limit; its key makes a repeat charge once. */
async function recordAttempt(
  context: RunContext,
  key: string,
  usage: AiTokenUsage,
  outcome: string,
  promptVersion = AI_PROMPT_VERSION,
): Promise<boolean> {
  return boundedWrite(
    'aiTurn: attempt record failed',
    AI_TURN_LIMITS[context.command.entryPoint].costWriteTimeoutMs,
    2,
    (signal) =>
      context.admin
        .rpc('record_ai_run_attempt', {
          p_organization_id: context.command.organizationId,
          p_run_id: context.runId,
          p_idempotency_key: key,
          p_model_id: context.model.modelId,
          p_prompt_version: promptVersion,
          p_input_tokens: usage.inputTokens,
          p_output_tokens: usage.outputTokens,
          p_cache_read_tokens: usage.cacheReadTokens,
          p_cache_write_tokens: usage.cacheWriteTokens,
          p_cost_micro_usd: costMicroUsd(usage, AI_MODEL_PRICE),
          p_outcome: outcome,
        })
        .abortSignal(signal),
  );
}

/**
 * The tools of the next model step: the caller's role's tools (B6), without
 * any memory write once the turn read untrusted text (B10).
 */
function prepareStep(context: RunContext, answer: Answer): ToolSet {
  const { tools } = context.modelContext;
  const offered = context.toolCalls.tainted ? tools.filter((tool) => !tool.writesMemory) : tools;
  return toToolSet(offered, (tool, input, toolCallId, signal) => {
    const run = toolRunFor(context, {
      signal: AbortSignal.any([context.turnSignal, answer.halt.signal, ...(signal ? [signal] : [])]),
      // A long read's progress saves the answer as a stream part does, so a stop or a lost thread aborts it.
      progress: () => savePartial(context, answer),
      admit: async () => (await readStepGate(context, answer, context.turnSignal)) === 'open',
      record: (key, ...attempt) => recordAttempt(context, key, ...attempt),
    });
    return runTool(context, tool, input, toolCallId, run);
  });
}
