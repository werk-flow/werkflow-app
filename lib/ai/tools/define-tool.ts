import 'server-only';

import { type ToolResultPart, type ToolSet, tool } from 'ai';

import type { ToolValue } from '@/lib/ai/context';
import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import type { OrgRole } from '@/lib/roles';
import type { z } from '@/lib/zod';

// The one way to give WerkFlow KI a tool (B2 of werk-flow/werkflow-planning#20,
// docs/technical/security.md, "Add an agent tool"). eslint.config.mjs bans the
// AI SDK's tool helpers everywhere else, and lib/ai/tools/registry.test.ts walks
// the registry for identity keys, length caps and boundary cases.

/** What a tool may do (B1): read, write a draft a person finishes, or ask first. No level reaches outside. */
type AiToolControl = 'read' | 'draft' | 'confirm';

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

/** A tool's answer. Only `ok` carries data; every other status is a stable code. */
export type AiToolResult = { status: 'ok'; value: ToolValue } | { status: 'refused' | 'failed' };

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
  control: AiToolControl;
  /** Where the call is recorded: a read writes only the run ledger's row (B19). */
  audit: 'ledger';
  /** A read repeats safely; a write's idempotency key comes with the first write tool. */
  idempotency: 'not_needed';
  dataClasses: readonly AiToolDataClass[];
  /** A memory write is removed for the rest of a turn that read untrusted text (B10). */
  writesMemory: boolean;
  /** Runs the page's own reader with the caller's context; never with an id the model names as identity. */
  execute: (input: Input, ctx: ActionContext) => Promise<AiToolResult>;
};

const DEFINED: unique symbol = Symbol('defined tool');

export type AiTool<Name extends string = string> = Readonly<
  Omit<AiToolSpec<Name, unknown>, 'execute' | 'input'>
> & {
  readonly inputSchema: z.ZodType;
  /** Parses the input and checks the role before the tool's own execute runs. */
  readonly execute: (input: unknown, ctx: ActionContext) => Promise<AiToolResult>;
  readonly [DEFINED]: true;
};

/** Defines one tool; lib/ai/tools/registry.ts lists every defined tool. */
export function defineTool<const Name extends string, Input>(spec: AiToolSpec<Name, Input>): AiTool<Name> {
  const { input: inputSchema, execute, ...fields } = spec;
  return {
    ...fields,
    inputSchema,
    [DEFINED]: true,
    async execute(input, ctx) {
      // The harness offers a tool only to its roles; this refuses a caller it reaches anyway.
      if (!spec.roles.includes(ctx.role)) return { status: 'refused' };
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { status: 'refused' };
      try {
        return await execute(parsed.data, ctx);
      } catch (error) {
        logError(`aiTool ${spec.name}: read failed`, error);
        return { status: 'failed' };
      }
    },
  };
}

/** Runs one call of an offered tool: the harness's checks, ledger row and output. */
type ToolRunner = (tool: AiTool, input: unknown, toolCallId: string) => Promise<ToolResultPart['output']>;

/** The tools of one model step as the AI SDK takes them; each call goes through `run`. */
export function toToolSet(tools: readonly AiTool[], run: ToolRunner): ToolSet {
  return Object.fromEntries(
    tools.map((entry) => [
      entry.name,
      tool({
        description: entry.description,
        inputSchema: entry.inputSchema,
        execute: (input: unknown, options) => run(entry, input, options.toolCallId),
        toModelOutput: ({ output }) => output,
      }),
    ]),
  );
}
