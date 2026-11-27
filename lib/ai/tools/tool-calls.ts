import 'server-only';

import type { ToolResultPart } from 'ai';

import { boundedWrite } from '@/lib/ai/bounded-write';
import { carriesUntrustedText, untrustedToolOutput } from '@/lib/ai/context';
import { AI_TURN_LIMITS } from '@/lib/ai/limits';
import { AI_PROMPT_VERSION } from '@/lib/ai/prompt/system-prompt';
import type { AiTool, AiToolResult } from '@/lib/ai/tools/define-tool';
import { AI_TOOLS } from '@/lib/ai/tools/registry';
import type { AiTurnCommand } from '@/lib/ai/turn';
import { getCachedMemberships } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { isManagerRole } from '@/lib/roles';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The tool calls of one WerkFlow KI turn (lib/ai/turn.ts): each runs as the
// current caller, and each call the model emits leaves a ledger row before
// the turn goes on. The thread's tool rows come with the chat's tool rows
// (werk-flow/werkflow-planning#533), written in one call with the ledger row.

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
};

/** A turn's tool calls before the first one. */
export function newToolCalls(): ToolCalls {
  return { tainted: false, unrecorded: false, count: 0, seen: new Map(), ran: new Set(), pending: new Map() };
}

/** The ledger key of the turn's next call: one per call, so a late repeat of its row lands once. */
function nextKey(context: ToolCallRun): string {
  context.toolCalls.count += 1;
  return `${context.runKey}:tool:${context.toolCalls.count}`;
}

/** What a turn's tool calls write with: its run, ledger key and caller. */
type ToolCallRun = {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  command: AiTurnCommand;
  runId: string;
  runKey: string;
  model: { modelId: string };
  toolCalls: ToolCalls;
};

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
): Promise<ToolResultPart['output']> {
  context.toolCalls.ran.add(toolCallId);
  if (context.toolCalls.unrecorded) return { type: 'json', value: { status: 'failed' } };
  const key = nextKey(context);
  context.toolCalls.pending.set(key, tool.name);
  const caller = await currentCaller(context.command).catch((error: unknown) => {
    logError('aiTurn: caller read failed', error);
    return 'failed' as const;
  });
  // A membership read that cannot decide refuses, as every identity check does.
  const result: AiToolResult =
    caller === 'failed'
      ? { status: 'failed' }
      : caller
        ? await tool.execute(input, caller)
        : { status: 'refused' };
  if (result.status === 'ok' && carriesUntrustedText(result.value)) context.toolCalls.tainted = true;
  const limitMs = AI_TURN_LIMITS[context.command.entryPoint].costWriteTimeoutMs;
  const recorded = await recordToolCall(context, key, tool.name, result.status, limitMs);
  context.toolCalls.pending.delete(key);
  if (!recorded) return { type: 'json', value: { status: 'failed' } };
  return result.status === 'ok'
    ? untrustedToolOutput(result.value)
    : { type: 'json', value: { status: result.status } };
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
    if (!(await recordToolCall(context, nextKey(context), name, 'not_run', left))) break;
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
    if (left <= 0 || !(await recordToolCall(context, key, name, 'failed', left))) {
      context.toolCalls.unrecorded = true;
      return;
    }
    context.toolCalls.pending.delete(key);
  }
}

/**
 * A tool call's ledger row (B19): the run names user, organization and
 * thread; the row names the tool, its outcome, the prompt version and the
 * model, with nil cost: ids and codes, never text. When it cannot be
 * written, the turn takes no further step.
 */
async function recordToolCall(
  context: ToolCallRun,
  key: string,
  name: string,
  status: AiToolResult['status'] | 'not_run',
  limitMs: number,
): Promise<boolean> {
  const recorded = await boundedWrite('aiTurn: tool call record failed', limitMs, 2, (signal) =>
    context.admin
      .rpc('record_ai_run_attempt', {
        p_organization_id: context.command.organizationId,
        p_run_id: context.runId,
        p_idempotency_key: key,
        p_model_id: context.model.modelId,
        p_prompt_version: AI_PROMPT_VERSION,
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_cache_read_tokens: 0,
        p_cache_write_tokens: 0,
        p_cost_micro_usd: 0,
        p_outcome: `tool_call_${name}_${status}`,
      })
      .abortSignal(signal),
  );
  if (!recorded) context.toolCalls.unrecorded = true;
  return recorded;
}
