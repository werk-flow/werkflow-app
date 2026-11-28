import 'server-only';

import type { ModelMessage, ToolResultPart } from 'ai';

import { boundedWrite } from '@/lib/ai/bounded-write';
import { carriesUntrustedText, toolResultBytes, untrustedToolOutput } from '@/lib/ai/context';
import { AI_TURN_LIMITS } from '@/lib/ai/limits';
import { AI_PROMPT_VERSION } from '@/lib/ai/prompt/system-prompt';
import { type QuestionBody, type TodoBody, type ToolCallBody, rowFromItem } from '@/lib/ai/thread-rows';
import type { AiThreadRow, AiToolOutcome } from '@/lib/ai/thread-types';
import type { AiTokenUsage } from '@/lib/ai/cost';
import type { AiModelCallRecord, AiTool, AiToolResult, AiToolRun } from '@/lib/ai/tools/define-tool';
import { AI_TOOLS } from '@/lib/ai/tools/registry';
import type { AiTurnCommand, AiTurnSink } from '@/lib/ai/turn';
import { getCachedMemberships } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { isManagerRole } from '@/lib/roles';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { z } from '@/lib/zod';

// The tool calls of one WerkFlow KI turn (lib/ai/turn.ts): each runs as the
// current caller, and each call the model emits leaves its thread row and its
// ledger row in one database call before the turn goes on
// (werk-flow/werkflow-planning#533). A tool's row shows while it runs; a
// harness tool's call shows as a question or as the turn's to-do list.

/** A row's detail above this size keeps the input and drops the result, under the item's 64 KB cap. */
const DETAIL_BYTES = 48_000;

/** Bytes under the result cap that only refusals may take: the sentence below and a few bare statuses. */
const RESULTS_FULL_ROOM_BYTES = 1_000;

/** What the model reads when a result would take the turn's tool results past their cap (`maxToolResultBytes`). */
const TOOL_RESULTS_FULL =
  'Die Ergebnisse dieser Antwort haben ihre Höchstgröße erreicht; dieses Ergebnis passt nicht mehr hinein. Antworte mit dem, was du schon hast, und schlag vor, in einer neuen Nachricht weiterzumachen.';

/** What the turn's tool calls did so far. */
export type ToolCalls = {
  /** A tool result carried untrusted text: memory writes are gone for the rest of the turn (B10). */
  tainted: boolean;
  /** A call's ledger row failed: the turn takes no further step. */
  unrecorded: boolean;
  /** The calls recorded so far, which number each call's ledger key. */
  count: number;
  /** The calls the current provider attempt emitted, by the provider's id. */
  seen: Map<string, string>;
  /** The provider's ids of the current attempt's calls a tool ran for. */
  ran: Set<string>;
  /** Calls a tool started whose ledger row is not written yet: tool name by ledger key. */
  pending: Map<string, string>;
  /** The agent asked the person a question: the turn ends after this step, and the answer is the next message. */
  asked: boolean;
  /** Bytes of the results the model read so far, against the turn's `maxToolResultBytes`. */
  resultBytes: number;
  /** A result was refused for the cap: no later result of the turn joins the context. */
  resultsFull: boolean;
  /** Even a bare status went past the result cap: the turn takes no further model step. */
  resultsOverflow: boolean;
  /** Model calls the tools started, against the turn's `maxToolModelCalls`. */
  modelCalls: number;
  /** The tools' model calls still running: the run settles only after each one is ledgered. */
  runningModelCalls: Set<Promise<unknown>>;
  /** A model call's cost row failed: the run keeps its provisional charge, as for a failed attempt row. */
  costUnrecorded: boolean;
};

/** A turn's tool calls before the first one. */
export function newToolCalls(): ToolCalls {
  return {
    tainted: false,
    unrecorded: false,
    count: 0,
    seen: new Map(),
    ran: new Set(),
    pending: new Map(),
    asked: false,
    resultBytes: 0,
    resultsFull: false,
    resultsOverflow: false,
    modelCalls: 0,
    runningModelCalls: new Set(),
    costUnrecorded: false,
  };
}

/** The ledger key of the turn's next call: one per call, so a late repeat of its row lands once. */
function nextKey(context: ToolCallRun): string {
  context.toolCalls.count += 1;
  return `${context.runKey}:tool:${context.toolCalls.count}`;
}

/** What a turn's tool calls write with: its run, ledger key and caller, and where their rows go live. */
type ToolCallRun = {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  command: AiTurnCommand;
  /** The person's message that started the turn. */
  userItem: { sequence: number };
  runId: string;
  runKey: string;
  model: { modelId: string };
  toolCalls: ToolCalls;
  sink: Pick<AiTurnSink, 'row'>;
};

/** One write of a row: the item it shows as, under its key, and the revision that orders its writes. */
type RowWrite =
  | { kind: 'tool_call'; key: string; status: AiThreadRow['status']; body: ToolCallBody; detail?: Json }
  | { kind: 'question'; key: string; status: 'complete'; body: QuestionBody }
  | { kind: 'todo_list'; key: string; status: 'complete'; body: TodoBody };

const questionInput = z.object({ frage: z.string(), optionen: z.array(z.string()) });
const todoInput = z.object({ schritte: z.array(z.object({ text: z.string(), erledigt: z.boolean() })) });

/** A tool row's summary: what the collapsed row shows. A name outside the registry shows as unknown. */
function toolBody(name: string, revision: number, outcome?: AiToolOutcome, detail?: boolean): ToolCallBody {
  const tool = AI_TOOLS.find((entry) => entry.name === name);
  return {
    revision,
    label: tool?.label ?? 'Unbekannte Aktion',
    control: tool?.control ?? 'read',
    ...(outcome ? { outcome } : {}),
    ...(detail ? { detail } : {}),
  };
}

/**
 * What an opened tool row shows: the validated input, and the result of a
 * call that ran, JSON-encoded as the model read it (record text with its
 * source label). A result over the cap stays out; the model's answer holds
 * what it took from it.
 */
function toolDetail(tool: AiTool, input: unknown, result: AiToolResult): Json | undefined {
  const parsed = z.json().safeParse(tool.inputSchema.safeParse(input).data);
  const shown = parsed.success && parsed.data !== undefined ? { input: parsed.data } : {};
  if (result.status !== 'ok') return parsed.success ? shown : undefined;
  const output = untrustedToolOutput(result.value);
  const value = z.json().safeParse(output.type === 'json' ? output.value : null);
  const full = { ...shown, result: value.success ? value.data : null };
  return Buffer.byteLength(JSON.stringify(full), 'utf8') <= DETAIL_BYTES
    ? full
    : { ...shown, resultOmitted: true };
}

/** The row a finished call writes: a harness tool's question or list, every other call's tool row. */
function finishedRow(
  context: ToolCallRun,
  key: string,
  tool: AiTool,
  input: unknown,
  result: AiToolResult,
): RowWrite {
  const ran = result.status === 'ok';
  // The row holds the input as the tool validated it, trimmed, so the thread reads back what the tool took.
  const validated = tool.inputSchema.safeParse(input).data;
  const question = tool.shows === 'question' && ran ? questionInput.safeParse(validated) : null;
  if (question?.success) {
    const { frage, optionen } = question.data;
    return {
      kind: 'question',
      key,
      status: 'complete',
      body: { revision: 1, question: frage, options: optionen },
    };
  }
  const todo = tool.shows === 'todo_list' && ran ? todoInput.safeParse(validated) : null;
  if (todo?.success) {
    // One list per turn: each call replaces it, and its call count orders the writes.
    const steps = todo.data.schritte.map((entry) => ({ text: entry.text, done: entry.erledigt }));
    return {
      kind: 'todo_list',
      key: `${context.runKey}:plan`,
      status: 'complete',
      body: { revision: context.toolCalls.count, steps },
    };
  }
  const detail = toolDetail(tool, input, result);
  return {
    kind: 'tool_call',
    key,
    status: ran ? 'complete' : 'failed',
    body: toolBody(tool.name, 2, result.status, detail !== undefined),
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * The caller as the membership reads now: the route resolved it at the
 * turn's start (`resolveActionContextFor`), and a member lowered or
 * suspended since gets their current role or nothing. Identity never comes
 * from the model (B3).
 */
async function currentCaller(command: AiTurnCommand): Promise<ActionContext | null> {
  const memberships = await getCachedMemberships(command.userId);
  const membership = memberships.find((entry) => entry.orgId === command.organizationId);
  if (!membership) return null;
  const { role } = membership;
  return {
    userId: command.userId,
    orgId: command.organizationId,
    role,
    isManagerOrAbove: isManagerRole(role),
  };
}

/**
 * The harness's side of one tool call (`AiToolRun`): the turn's thread, its
 * abort signal, a progress hook that saves the answer, and the tools' model
 * calls within the turn's `maxToolModelCalls`, which the run's reservation
 * covers at the extractor's caps. Each model call has its own ledger key; a
 * row that cannot be written ends the turn, and the run settles only after
 * every model call ended (lib/ai/turn.ts).
 */
export function toolRunFor(
  context: ToolCallRun,
  tool: AiTool,
  hooks: {
    signal: AbortSignal;
    progress: () => void;
    /** Reads the turn's gate again (switch, stop, access): whether the turn may take a model step now. */
    gate: () => Promise<boolean>;
    record: (key: string, usage: AiTokenUsage, outcome: string, promptVersion: string) => Promise<boolean>;
  },
): AiToolRun {
  const { toolCalls } = context;
  const canCallModel = () =>
    toolCalls.modelCalls < AI_TURN_LIMITS[context.command.entryPoint].maxToolModelCalls;
  // A member lowered or suspended while the tool read sends nothing more (B5).
  const admit = async () => {
    if (hooks.signal.aborted || !(await hooks.gate())) return false;
    const caller = await currentCaller(context.command).catch(() => null);
    return caller !== null && tool.roles.includes(caller.role) && !hooks.signal.aborted;
  };
  return {
    threadId: context.command.threadId,
    beforeSequence: context.userItem.sequence,
    signal: hooks.signal,
    progress: hooks.progress,
    canCallModel,
    admit,
    async modelCall<T>(call: (record: AiModelCallRecord) => Promise<T>): Promise<T | 'over_cap' | 'stopped'> {
      if (!canCallModel()) return 'over_cap';
      // A stop, a lost thread, a switch or a lowered role that landed meanwhile never reaches a paid call.
      if (!(await admit())) return 'stopped';
      if (!canCallModel()) return 'over_cap';
      toolCalls.modelCalls += 1;
      const key = `${context.runKey}:model-call:${toolCalls.modelCalls}`;
      const running = call(async (usage, outcome, promptVersion) => {
        const recorded = await hooks.record(key, usage, outcome, promptVersion);
        if (!recorded) Object.assign(toolCalls, { unrecorded: true, costUnrecorded: true });
        return recorded;
      });
      toolCalls.runningModelCalls.add(running);
      try {
        return await running;
      } finally {
        toolCalls.runningModelCalls.delete(running);
      }
    },
  };
}

/** A result's bytes as the model reads it. */
const outputBytes = (output: ToolResultPart['output']): number =>
  Buffer.byteLength(JSON.stringify(output.type === 'json' ? output.value : null), 'utf8');

/**
 * A result within the turn's cap on all tool results together; past it, a
 * refusal the model can read, never a cut result. Every output the model
 * reads counts, refusals included; the thread leaves the cap's room free
 * (lib/ai/turn.ts).
 */
function withinResultCap(context: ToolCallRun, result: AiToolResult): AiToolResult {
  const { toolCalls } = context;
  if (result.status !== 'ok') return result;
  const cap = AI_TURN_LIMITS[context.command.entryPoint].maxToolResultBytes;
  const bytes = toolResultBytes(result.value);
  // The last bytes under the cap stay free for the refusals that may follow (`RESULTS_FULL_ROOM_BYTES`).
  if (!toolCalls.resultsFull && toolCalls.resultBytes + bytes <= cap - RESULTS_FULL_ROOM_BYTES) return result;
  // The sentence goes once; every later call past the cap reads the bare status (`toolFramingBytes`).
  const first = !toolCalls.resultsFull;
  toolCalls.resultsFull = true;
  return first ? { status: 'refused', message: TOOL_RESULTS_FULL } : { status: 'refused' };
}

/**
 * What the model reads of a call, counted against the turn's result cap. An
 * output that does not fit reads as its bare status; when even that does not
 * fit, the turn takes no further step (lib/ai/turn.ts).
 */
function modelOutput(context: ToolCallRun, result: AiToolResult): ToolResultPart['output'] {
  const { toolCalls } = context;
  const cap = AI_TURN_LIMITS[context.command.entryPoint].maxToolResultBytes;
  const status = result.status === 'ok' ? 'refused' : result.status;
  const bare: ToolResultPart['output'] = { type: 'json', value: { status } };
  let output: ToolResultPart['output'] =
    result.status === 'ok'
      ? untrustedToolOutput(result.value)
      : { type: 'json', value: result.message ? { status, meldung: result.message } : { status } };
  if (toolCalls.resultBytes + outputBytes(output) > cap) output = bare;
  if (toolCalls.resultBytes + outputBytes(output) > cap) toolCalls.resultsOverflow = true;
  toolCalls.resultBytes += outputBytes(output);
  return output;
}

/**
 * A step's messages with the results the AI SDK wrote itself, such as the
 * error for an input its schema refused, counted against the turn's result
 * cap like every result a tool returned: one that does not fit reads as the
 * bare `not_run`, and when even that does not fit, the turn takes no further step.
 */
export function withinResultCapForSdkErrors(context: ToolCallRun, messages: ModelMessage[]): ModelMessage[] {
  const { toolCalls } = context;
  const cap = AI_TURN_LIMITS[context.command.entryPoint].maxToolResultBytes;
  return messages.map((message) => {
    if (message.role !== 'tool') return message;
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result' || !part.output.type.startsWith('error')) return part;
      let output: ToolResultPart['output'] = part.output;
      const bytesOf = (value: ToolResultPart['output']) =>
        Buffer.byteLength(JSON.stringify('value' in value ? value.value : null), 'utf8');
      if (toolCalls.resultBytes + bytesOf(output) > cap)
        output = { type: 'json', value: { status: 'not_run' } };
      if (toolCalls.resultBytes + bytesOf(output) > cap) toolCalls.resultsOverflow = true;
      toolCalls.resultBytes += bytesOf(output);
      return { ...part, output };
    });
    return { ...message, content };
  });
}

/**
 * Runs one offered tool as the current caller. The model's calls run one at
 * a time; none runs once a call went unrecorded. Record text in a result
 * taints the turn, and the call's ledger row is written before the result
 * reaches the model.
 */
export async function runTool(
  context: ToolCallRun,
  tool: AiTool,
  input: unknown,
  toolCallId: string,
  run: AiToolRun,
): Promise<ToolResultPart['output']> {
  context.toolCalls.ran.add(toolCallId);
  if (context.toolCalls.unrecorded) return { type: 'json', value: { status: 'failed' } };
  const key = nextKey(context);
  context.toolCalls.pending.set(key, tool.name);
  const limitMs = AI_TURN_LIMITS[context.command.entryPoint].costWriteTimeoutMs;
  // A tool's row shows while it runs; a missed write costs only that, as the finished row follows.
  const running = tool.shows
    ? null
    : writeRow(
        context,
        { kind: 'tool_call', key, status: 'streaming', body: toolBody(tool.name, 1) },
        null,
        limitMs,
      );
  const caller = await currentCaller(context.command).catch((error: unknown) => {
    logError('aiTurn: caller read failed', error);
    return 'failed' as const;
  });
  // A membership read that cannot decide refuses, as every identity check does.
  const executed: AiToolResult =
    caller === 'failed'
      ? { status: 'failed' }
      : caller
        ? await tool.execute(input, caller, run)
        : { status: 'refused' };
  const result = withinResultCap(context, executed);
  if (result.status === 'ok' && carriesUntrustedText(result.value)) context.toolCalls.tainted = true;
  await running;
  const row = finishedRow(context, key, tool, input, result);
  const recorded = await recordToolCall(context, key, tool.name, result.status, limitMs, row);
  if (recorded && row.kind === 'question') context.toolCalls.asked = true;
  context.toolCalls.pending.delete(key);
  return modelOutput(context, recorded ? result : { status: 'failed' });
}

/**
 * Records every call one provider attempt emitted that no tool ran for: one
 * the turn did not offer, one whose input its schema refused, or one of an
 * attempt that broke off. A name outside the registry is model text and is
 * recorded as `unknown`. The whole batch shares one write's time limit, so
 * the turn keeps its time to save and settle; the first write that fails or
 * runs out of time stops the rest and ends the turn. The attempt's calls are
 * then forgotten, so a retry's calls are its own.
 */
export async function recordUnrunCalls(context: ToolCallRun): Promise<void> {
  const { seen, ran } = context.toolCalls;
  const deadline = Date.now() + AI_TURN_LIMITS[context.command.entryPoint].costWriteTimeoutMs;
  for (const [toolCallId, toolName] of seen) {
    if (ran.has(toolCallId)) continue;
    const name = AI_TOOLS.some((tool) => tool.name === toolName) ? toolName : 'unknown';
    const left = deadline - Date.now();
    if (context.toolCalls.unrecorded || left <= 0) {
      context.toolCalls.unrecorded = true;
      break;
    }
    const key = nextKey(context);
    const row: RowWrite = { kind: 'tool_call', key, status: 'failed', body: toolBody(name, 2, 'not_run') };
    if (!(await recordToolCall(context, key, name, 'not_run', left, row))) break;
  }
  seen.clear();
  ran.clear();
}

/**
 * Records the calls whose tool was still running when the turn ended, as
 * failed, before the run settles: no call leaves the turn without its row.
 * Their result never reaches the model; a row the tool writes later under
 * the same key lands once. The batch shares one write's time limit.
 */
export async function recordPendingCalls(context: ToolCallRun): Promise<void> {
  const deadline = Date.now() + AI_TURN_LIMITS[context.command.entryPoint].costWriteTimeoutMs;
  for (const [key, name] of context.toolCalls.pending) {
    const left = deadline - Date.now();
    const row: RowWrite = { kind: 'tool_call', key, status: 'failed', body: toolBody(name, 2, 'failed') };
    if (left <= 0 || !(await recordToolCall(context, key, name, 'failed', left, row))) {
      context.toolCalls.unrecorded = true;
      return;
    }
    context.toolCalls.pending.delete(key);
  }
}

/**
 * Writes a row of the run's thread, and with `ledger` the call's ledger row
 * in the same database call. The row then goes live to the author's tabs.
 * Resolves whether both landed.
 */
async function writeRow(
  context: ToolCallRun,
  row: RowWrite,
  ledger: { key: string; outcome: string } | null,
  limitMs: number,
): Promise<boolean> {
  let sequence: number | null = null;
  const written = await boundedWrite(
    ledger ? 'aiTurn: tool call record failed' : 'aiTurn: tool row write failed',
    limitMs,
    ledger ? 2 : 1,
    async (signal) => {
      const answer = await context.admin
        .rpc('record_ai_tool_item', {
          p_organization_id: context.command.organizationId,
          p_user_id: context.command.userId,
          p_run_id: context.runId,
          p_kind: row.kind,
          p_status: row.status,
          p_item_key: row.key,
          p_body: row.body,
          ...(row.kind === 'tool_call' && row.detail !== undefined ? { p_detail: row.detail } : {}),
          ...(ledger
            ? {
                p_ledger_key: ledger.key,
                p_model_id: context.model.modelId,
                p_prompt_version: AI_PROMPT_VERSION,
                p_outcome: ledger.outcome,
              }
            : {}),
        })
        .abortSignal(signal);
      // A null sequence: another write already recorded this call's outcome, so nothing changed.
      if (!answer.error && typeof answer.data === 'number') sequence = answer.data;
      return answer;
    },
  );
  const shown = sequence === null ? null : rowFromItem({ ...row, idempotency_key: row.key, sequence });
  if (shown) context.sink.row?.(shown);
  return written;
}

/**
 * A tool call's row and its ledger row (B19): the run names user,
 * organization and thread; the ledger row names the tool, its outcome, the
 * prompt version and the model, with nil cost: ids and codes, never text.
 * When they cannot be written, the turn takes no further step.
 */
async function recordToolCall(
  context: ToolCallRun,
  key: string,
  name: string,
  status: AiToolOutcome,
  limitMs: number,
  row: RowWrite,
): Promise<boolean> {
  const recorded = await writeRow(context, row, { key, outcome: `tool_call_${name}_${status}` }, limitMs);
  if (!recorded) context.toolCalls.unrecorded = true;
  return recorded;
}
