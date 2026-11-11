import type { Admission } from './machine-room';

/**
 * The rule of the child-start guard (.claude/hooks/refuse-child-start-without-room.ts):
 * a lead starts a thread on its own machine only while the machine has room for
 * it (machine-room.ts). Owner decision 19 set no fixed number of child threads,
 * and on 2026-11-11 nothing looked before the 18th started
 * (werk-flow/werkflow-planning#294).
 *
 * A thread placed on another machine passes: this guard measures only the
 * machine it runs on, and the target's own setup and heavy gates still hold.
 * Native subagents run inside the lead's process and pass no gate.
 */

/** T3 Code's tools that start a thread, as both agent tools name them after `mcp__<server>__`. */
const THREAD_STARTS = /^mcp__.+__(delegate_task|t3_thread_launch|create_threads)$/;

const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
/** A thread stays on this machine unless the call names an environment for it. */
const isLocal = (environmentId: unknown): boolean =>
  typeof environmentId !== 'string' || environmentId === '';

/**
 * How many threads a tool call starts on this machine, or undefined when the
 * named tool starts none. `delegate_task` and each entry of `create_threads`
 * place a thread with `target.environmentId`, `t3_thread_launch` with `environmentId`.
 */
export function localThreadStarts(toolName: string, input: unknown): number | undefined {
  const tool = THREAD_STARTS.exec(toolName)?.[1];
  if (!tool) return undefined;
  if (tool === 't3_thread_launch') return isLocal(field(input, 'environmentId')) ? 1 : 0;
  if (tool === 'delegate_task') return isLocal(field(field(input, 'target'), 'environmentId')) ? 1 : 0;
  const threads = field(input, 'threads');
  // A call the guard cannot read is judged as one local thread.
  if (!Array.isArray(threads)) return 1;
  return threads.filter((thread) => isLocal(field(field(thread, 'target'), 'environmentId'))).length;
}

/**
 * The refusal of a tool call that starts threads on a machine without room for
 * them, with the numbers and the ways on, or undefined. `call` is the hook's
 * payload as it arrived; `measure` answers for the number of threads the call
 * starts here. A payload that names no tool is refused: the hook runs only
 * before a thread start, so one it cannot read may be one.
 */
export function childStartRefusal(
  call: unknown,
  measure: (threads: number) => Admission,
): string | undefined {
  const toolName = field(call, 'tool_name');
  if (typeof toolName !== 'string' || toolName === '')
    return 'Refused: the child-start guard could not read the tool call, so it cannot tell whether this machine has room.';
  const threads = localThreadStarts(toolName, field(call, 'tool_input'));
  if (!threads) return undefined;
  const verdict = measure(threads);
  if (verdict.admitted) return undefined;
  const what = threads === 1 ? 'a thread' : `${threads} threads`;
  const elsewhere =
    'place it on a linked machine: `t3_environment_links` lists them, then pass `target.environmentId` (`environmentId` for `t3_thread_launch`)';
  if (verdict.unwatched)
    return `Refused: this machine cannot start ${what}. ${verdict.reason} Until then, ${elsewhere}.`;
  return [
    `Refused: this machine has no room to start ${what}. ${verdict.reason}`,
    `Two ways on: ${elsewhere}; or run \`bun run room --wait thread\`, which returns once this machine has room for one, and start it then.`,
    ...(threads === 1 ? [] : ['Several threads fit sooner one at a time.']),
  ].join(' ');
}
