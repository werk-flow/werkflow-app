import { type ModelMessage, type ToolResultPart, type ToolSet, asSchema } from 'ai';

import { inputTokenCeiling } from '@/lib/ai/limits';
import { AI_SYSTEM_PROMPT } from '@/lib/ai/prompt/system-prompt';
import type { OrgRole } from '@/lib/roles';

// The one context builder of WerkFlow KI (B8 and B18 of
// werk-flow/werkflow-planning#20). It decides what the model reads, in the
// order the provider caches it: the system prompt and the tools, then the
// organization memory, the person memory, and the thread. The system prompt
// is the public constant and nothing else. Text that neither the person nor
// WerkFlow wrote (documents, file names, record free text, memory) reaches the
// model only as an `UntrustedText` inside a tool result, labelled with its
// source and JSON-encoded, so it never speaks as the system or the person.

/** Where untrusted text came from: the label the model reads beside it. */
type UntrustedSource = 'document' | 'file_name' | 'record_text' | 'organization_memory' | 'person_memory';

// Module-private: only this module can read the text out, so untrusted text
// cannot become a system prompt or a person's message anywhere else.
const TEXT: unique symbol = Symbol('untrusted text');

/** Text from outside the conversation, cleaned and labelled; it reads only as a tool result. */
export type UntrustedText = { readonly source: UntrustedSource; readonly [TEXT]: string };

/**
 * The characters a person cannot see, each a known way to hide instructions
 * in text: zero-width and other default-ignorable characters, which include
 * Unicode tags and variation selectors, the bidirectional controls, and the
 * control characters other than tab and line breaks.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}\p{Cc}]/gu;
const VISIBLE_CONTROLS = new Set(['\t', '\n', '\r']);

/**
 * Text as a person sees it: without invisible characters, then NFC-normalized,
 * so a mark a removed character separated still composes. NFC, not NFKC, so
 * trade notation such as ½" and m² keeps its meaning.
 */
function visibleText(text: string): string {
  return text.replace(INVISIBLE, (char) => (VISIBLE_CONTROLS.has(char) ? char : '')).normalize('NFC');
}

/** Whether a message holds text a person can see: one without it would reach the model empty. */
export function hasVisibleText(text: string): boolean {
  return visibleText(text).trim().length > 0;
}

/** Untrusted text from `source`, cleaned before anything can read it. */
export function untrustedText(source: UntrustedSource, text: string): UntrustedText {
  return { source, [TEXT]: visibleText(text) };
}

/**
 * A tool's output that carries untrusted text: JSON with the source label
 * beside the text. Typed as the SDK's tool-result output, so its text has no
 * typed path into the system prompt or a message.
 */
export function untrustedToolOutput(text: UntrustedText): ToolResultPart['output'] {
  return { type: 'json', value: { source: text.source, text: text[TEXT] } };
}

/** One saved message of the thread: the person's own words or an earlier answer. */
export type AiThreadMessage = { role: 'user' | 'assistant'; text: string };

/**
 * The tools each role's model sees (B6). The tool registry of
 * werk-flow/werkflow-planning#531 fills them; until then no role has a tool.
 */
const AI_TOOLS: Readonly<Record<OrgRole, ToolSet>> = { admin: {}, buero: {}, employee: {} };

export type AiContext = {
  instructions: string;
  tools: ToolSet;
  /** The tool definitions as the model reads them: their share of the input. */
  toolDefinitions: string;
  messages: ModelMessage[];
};

/** A tool set's definitions as the provider sends them, sorted by name so equal sets measure equal. */
async function serializedToolDefinitions(tools: ToolSet): Promise<string> {
  const definitions = await Promise.all(
    Object.entries(tools)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(async ([name, tool]) => ({
        name,
        description: 'description' in tool && typeof tool.description === 'string' ? tool.description : null,
        inputSchema: await asSchema(tool.inputSchema).jsonSchema,
      })),
  );
  return JSON.stringify(definitions);
}

/** The input a model step sends, serialized: what its input token bound is taken of. */
export function serializedInput(
  context: Pick<AiContext, 'instructions' | 'toolDefinitions'>,
  messages: readonly ModelMessage[],
): string {
  return JSON.stringify([context.instructions, messages]) + context.toolDefinitions;
}

/**
 * The context of one turn for a person of `role`. The thread is oldest first
 * and ends with the new message; its oldest messages drop first until the
 * input fits `inputTokenCap`, and the new message always stays.
 */
export async function buildAiContext(input: {
  role: OrgRole;
  thread: readonly AiThreadMessage[];
  inputTokenCap: number;
}): Promise<AiContext> {
  const tools = AI_TOOLS[input.role];
  const context = {
    instructions: AI_SYSTEM_PROMPT,
    tools,
    toolDefinitions: await serializedToolDefinitions(tools),
  };
  // A saved message with nothing visible left would reach the provider as an empty block.
  const thread = input.thread.flatMap((message): ModelMessage[] => {
    const content = visibleText(message.text);
    return content.trim() ? [{ role: message.role, content }] : [];
  });
  // The organization memory and then the person memory (werk-flow/werkflow-planning#539 and #538)
  // come before the thread, each as a labelled tool result.
  let kept = thread;
  // The provider takes a conversation that opens with the person's message.
  while (
    kept.length > 1 &&
    (kept[0]?.role !== 'user' || inputTokenCeiling(serializedInput(context, kept)) > input.inputTokenCap)
  ) {
    kept = kept.slice(1);
  }
  return { ...context, messages: kept };
}
