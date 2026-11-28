import 'server-only';

import { type ToolResultPart, type ToolSet, tool } from 'ai';

import type { ToolValue } from '@/lib/ai/context';
import type { AiTokenUsage } from '@/lib/ai/cost';
import type { AiToolControl } from '@/lib/ai/thread-types';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import type { OrgRole } from '@/lib/roles';
import type { z } from '@/lib/zod';

// The one way to give WerkFlow KI a tool (B2 of werk-flow/werkflow-planning#20,
// docs/technical/security.md, "Add an agent tool"). eslint.config.mjs bans the
// AI SDK's tool helpers everywhere else, and lib/ai/tools/registry.test.ts walks
// the registry for identity keys, length caps and boundary cases.

/**
 * The data classes a tool may return. Personnel, health, time, Zeitkonto,
 * payroll and bank data have no class here, so no tool can declare them (B6).
 */
type AiToolDataClass =
  | 'work'
  | 'customer'
  | 'staff-name'
  | 'absence'
  | 'article'
  | 'price'
  | 'commercial'
  | 'document'
  | 'evidence'
  | 'equipment';

/**
 * A tool's answer. Only `ok` carries data; every other status is a stable
 * code, with a fixed German sentence of the harness when the person can act on it.
 */
export type AiToolResult =
  | { status: 'ok'; value: ToolValue }
  | { status: 'refused' | 'failed'; message?: string };

/** Ledgers one model call of a tool at its usage and outcome; false when the ledger could not take it. */
export type AiModelCallRecord = (
  usage: AiTokenUsage,
  outcome: string,
  promptVersion: string,
) => Promise<boolean>;

/** What the harness gives one tool call besides the caller: never a value the model chose (B3). */
export type AiToolRun = {
  /** The turn's thread, whose author is the caller. */
  threadId: string;
  /** Aborts when the person stops the answer, loses the thread, or the turn's time is up. */
  signal: AbortSignal;
  /**
   * A long read calls it as it goes, such as on each part of a model call's
   * stream: the turn saves its answer at most every save interval, which is how
   * it hears a stop or a lost thread and aborts `signal`.
   */
  progress: () => void;
  /** Whether the turn has a model call left: a tool checks it before it reads what it would send. */
  canCallModel: () => boolean;
  /**
   * Runs one model call of the tool, such as the quarantined extractor's, under
   * the turn's cap and its reservation; `call` ledgers it through `record`, and
   * the run settles only after `call` ended. `over_cap` when the turn has no call
   * left; `stopped` when the turn, read again just before, may take no model call.
   */
  modelCall: <T>(call: (record: AiModelCallRecord) => Promise<T>) => Promise<T | 'over_cap' | 'stopped'>;
};

type AiToolSpec<Name extends string, Input> = {
  /** What the model calls: lowercase German words joined by `_`. */
  name: Name;
  /** What the person reads in the thread. */
  label: string;
  /** What the model reads: when to call the tool and what it returns. */
  description: string;
  /** A strict object schema with a length cap on every string and list; no identity key (B3). */
  input: z.ZodType<Input>;
  /** Who gets the tool (B6); the domain reader's own role and object checks still run. */
  roles: readonly OrgRole[];
  /** What a tool may do (B1): read, write a draft a person finishes, or ask first. No level reaches outside. */
  control: AiToolControl;
  /**
   * A harness tool's row in the thread: its validated input is a question
   * with options or the turn's to-do list. Every other tool's call shows as a
   * tool row.
   */
  shows?: 'question' | 'todo_list';
  /** Where the call is recorded: a read writes only the run ledger's row (B19). */
  audit: 'ledger';
  /** A read repeats safely; a write's idempotency key comes with the first write tool. */
  idempotency: 'not_needed';
  dataClasses: readonly AiToolDataClass[];
  /** A memory write is removed for the rest of a turn that read untrusted text (B10). */
  writesMemory: boolean;
  /** Runs the page's own reader with the caller's context; never with an id the model names as identity. */
  execute: (input: Input, ctx: ActionContext, run: AiToolRun) => Promise<AiToolResult>;
};

const DEFINED: unique symbol = Symbol('defined tool');

export type AiTool<Name extends string = string> = Readonly<
  Omit<AiToolSpec<Name, unknown>, 'execute' | 'input'>
> & {
  readonly inputSchema: z.ZodType;
  /** Parses the input and checks the role before the tool's own execute runs. */
  readonly execute: (input: unknown, ctx: ActionContext, run: AiToolRun) => Promise<AiToolResult>;
  readonly [DEFINED]: true;
};

/** Defines one tool; lib/ai/tools/registry.ts lists every defined tool. */
export function defineTool<const Name extends string, Input>(spec: AiToolSpec<Name, Input>): AiTool<Name> {
  const { input: inputSchema, execute, ...fields } = spec;
  return {
    ...fields,
    inputSchema,
    [DEFINED]: true,
    async execute(input, ctx, run) {
      // The harness offers a tool only to its roles; this refuses a caller it reaches anyway.
      if (!spec.roles.includes(ctx.role)) return { status: 'refused' };
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { status: 'refused' };
      try {
        return await execute(parsed.data, ctx, run);
      } catch (error) {
        logError(`aiTool ${spec.name}: read failed`, error);
        return { status: 'failed' };
      }
    },
  };
}

/** Runs one call of an offered tool: the harness's checks, ledger row and output. */
type ToolRunner = (
  tool: AiTool,
  input: unknown,
  toolCallId: string,
  signal: AbortSignal | undefined,
) => Promise<ToolResultPart['output']>;

/** The tools of one model step as the AI SDK takes them; each call goes through `run`. */
export function toToolSet(tools: readonly AiTool[], run: ToolRunner): ToolSet {
  return Object.fromEntries(
    tools.map((entry) => [
      entry.name,
      tool({
        description: entry.description,
        inputSchema: entry.inputSchema,
        execute: (input: unknown, options) => run(entry, input, options.toolCallId, options.abortSignal),
        toModelOutput: ({ output }) => output,
      }),
    ]),
  );
}
