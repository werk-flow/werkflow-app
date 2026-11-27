// The registry walks of WerkFlow KI's tools (B3 and B5 of werk-flow/werkflow-planning#20).
// lib/ai/tools/registry.test.ts walks the real registry and plants a tool that breaks each
// rule; lib/testing/fixtures/ai-tool-boundaries.ts walks the real registry's boundary cases.
import { z } from '@/lib/zod';

/** What the walks read of a tool. */
type WalkedTool = {
  name: string;
  label: string;
  roles: readonly string[];
  /** The input schema as the provider receives it. */
  inputJsonSchema: unknown;
};

/** The three boundary cases every tool runs through the real turn path (B5). */
const BOUNDARY_CASES = ['foreignOrganization', 'lowerRole', 'suspendedMember'] as const;
type BoundaryCase = (typeof BOUNDARY_CASES)[number];

/** A key that would let the model name who acts or where (B3). */
const IDENTITY_KEY = /organi[sz]ation|^org|user|member|role|tenant/i;
/** A name the ledger's outcome code holds: `tool_call_<name>_not_run` stays within 63 characters. */
const TOOL_NAME = /^[a-z][a-z_]{2,44}$/;

const schemaNode = z.object({
  type: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.unknown().optional(),
  anyOf: z.array(z.unknown()).optional(),
  enum: z.array(z.unknown()).optional(),
  format: z.string().optional(),
  maxLength: z.number().optional(),
  maxItems: z.number().optional(),
});

/** The breaches of one JSON schema node: identity keys and uncapped strings or lists. */
function schemaProblems(tool: string, value: unknown, path: string): string[] {
  const node = schemaNode.safeParse(value);
  if (!node.success) return [`${tool}: ${path} is no schema`];
  const { type, properties, items, anyOf, maxLength, maxItems } = node.data;
  const problems = (anyOf ?? []).flatMap((option, index) => schemaProblems(tool, option, `${path}|${index}`));
  if (type === 'object') {
    for (const [key, property] of Object.entries(properties ?? {})) {
      if (IDENTITY_KEY.test(key)) problems.push(`${tool}: ${path}.${key} names an identity`);
      problems.push(...schemaProblems(tool, property, `${path}.${key}`));
    }
  }
  // A uuid has a fixed length; an enum lists its values.
  if (type === 'string' && maxLength === undefined && !node.data.enum && node.data.format !== 'uuid')
    problems.push(`${tool}: ${path} has no length cap`);
  if (type === 'array') {
    if (maxItems === undefined) problems.push(`${tool}: ${path} has no item cap`);
    problems.push(...schemaProblems(tool, items, `${path}[]`));
  }
  return problems;
}

/**
 * The breaches of the registry's rules (B3): a unique name the ledger can
 * hold, a label, at least one role, and an input schema with a cap on every
 * string and list and no identity key.
 */
export function aiToolSchemaProblems(tools: readonly WalkedTool[]): string[] {
  const names = tools.map((tool) => tool.name);
  return tools.flatMap((tool) => {
    const problems = schemaProblems(tool.name, tool.inputJsonSchema, 'input');
    if (!TOOL_NAME.test(tool.name)) problems.push(`${tool.name}: the name is no ledger code`);
    if (names.indexOf(tool.name) !== names.lastIndexOf(tool.name)) problems.push(`${tool.name}: twice`);
    if (!tool.label.trim()) problems.push(`${tool.name}: no label`);
    if (tool.roles.length === 0) problems.push(`${tool.name}: no role`);
    return problems;
  });
}

/** Each tool of `names` without all three boundary cases (B5). */
export function missingBoundaryCases(
  names: readonly string[],
  boundaries: Readonly<Record<string, Partial<Record<BoundaryCase, unknown>>>>,
): string[] {
  return names.flatMap((name) =>
    BOUNDARY_CASES.flatMap((boundary) =>
      typeof boundaries[name]?.[boundary] === 'function' ? [] : [`${name}: no ${boundary} boundary case`],
    ),
  );
}
