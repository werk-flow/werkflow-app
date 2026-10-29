/**
 * The rule of the agent delete guard (.claude/hooks/refuse-unresolvable-delete.ts):
 * Claude Code's built-in safety check cannot resolve the target of an `rm`
 * whose operand is a variable or a wildcard on a relative path, so it asks the
 * owner even in full access, with or without an earlier `cd`. The guard refuses
 * that shape and names the form the check can resolve.
 */

/** A shell word: its text without quotes, and whether the shell would glob or expand it. */
type ShellWord = { text: string; globs: boolean; expands: boolean };

const OPERATORS = new Set([';', '&', '|', '(', ')', '\n']);
const GLOB_CHARACTERS = new Set(['*', '?', '[']);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const REDIRECTION = /^\d*[<>]/;
const BARE_REDIRECTION = /^\d*[<>]+&?$/;
const HEREDOC = /(?<!<)<<-?\s*(["']?)([^\s"';&|<>()]+)\1/g;

/** The command without its heredoc bodies, which are data, not commands. */
function withoutHeredocBodies(command: string): string {
  const kept: string[] = [];
  let delimiters: string[] = [];
  for (const line of command.split('\n')) {
    if (delimiters.length > 0) {
      if (line.trim() === delimiters[0]) delimiters = delimiters.slice(1);
      continue;
    }
    kept.push(line);
    delimiters = [...line.matchAll(HEREDOC)].map((match) => match[2] ?? '');
  }
  return kept.join('\n');
}

/**
 * The simple commands of a shell line, split at operators, newlines and
 * parentheses. Quotes and backslashes are honored; a `#` that starts a word
 * comments out the rest of its line. Nested shells (`bash -c "..."`) stay one word.
 */
function simpleCommands(command: string): ShellWord[][] {
  const commands: ShellWord[][] = [];
  let words: ShellWord[] = [];
  let word: ShellWord | undefined;
  let quote: '' | "'" | '"' = '';
  const current = (): ShellWord => (word ??= { text: '', globs: false, expands: false });
  const endWord = () => {
    if (word) words.push(word);
    word = undefined;
  };
  for (let index = 0; index < command.length; index++) {
    const character = command.charAt(index);
    if (quote === "'") {
      if (character === "'") quote = '';
      else current().text += character;
      continue;
    }
    if (character === '\\') {
      // A backslash-newline continues the line and adds nothing.
      const escaped = command.charAt(++index);
      if (escaped !== '\n') current().text += escaped;
      continue;
    }
    if (character === '$' || character === '`') current().expands = true;
    if (quote === '"') {
      if (character === '"') quote = '';
      else current().text += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current();
    } else if (character === '#' && !word) {
      while (index + 1 < command.length && command.charAt(index + 1) !== '\n') index++;
    } else if (character === ' ' || character === '\t') {
      endWord();
    } else if (OPERATORS.has(character) && !(character === '&' && /[<>]$/.test(word?.text ?? ''))) {
      endWord();
      commands.push(words);
      words = [];
    } else {
      // A redirection splits from an operand it touches (`/tmp/x/*>log`), not from its descriptor (`2>`).
      if ((character === '<' || character === '>') && word && !/^\d*[<>]*$/.test(word.text)) endWord();
      if (GLOB_CHARACTERS.has(character)) current().globs = true;
      current().text += character;
    }
  }
  endWord();
  commands.push(words);
  return commands.filter((simple) => simple.length > 0);
}

/** The program and arguments of a simple command, past leading variable assignments and `sudo`. */
function program(words: ShellWord[]): { name: string; args: ShellWord[] } | undefined {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word.text) && word.text !== 'sudo');
  const head = words[start];
  if (!head) return undefined;
  return {
    name: head.text.slice(head.text.lastIndexOf('/') + 1),
    args: withoutRedirections(words.slice(start + 1)),
  };
}

/** The arguments without redirections (`> "$log"`, `2>&1`) and their targets, which are no operands. */
function withoutRedirections(args: readonly ShellWord[]): ShellWord[] {
  return args.filter(
    (arg, index) => !REDIRECTION.test(arg.text) && !BARE_REDIRECTION.test(args[index - 1]?.text ?? ''),
  );
}

/** Operands whose directory the shell decides: a variable anywhere, or a wildcard on a relative path. */
function unresolvedOperands(args: readonly ShellWord[]): string[] {
  const end = args.findIndex((arg) => arg.text === '--');
  return args
    .filter((arg, index) => (end !== -1 && index > end) || !arg.text.startsWith('-'))
    .filter((arg) => arg.expands || (arg.globs && !arg.text.startsWith('/')))
    .map((arg) => arg.text);
}

/**
 * The refusal of a shell command that runs `rm`, with any flags, on a variable
 * or on a wildcard with a relative path, or undefined. A delete with an
 * explicit absolute path (`rm -f /tmp/x/*`) passes.
 */
export function unresolvableDeleteRefusal(command: string): string | undefined {
  for (const words of simpleCommands(withoutHeredocBodies(command))) {
    const call = program(words);
    if (call?.name !== 'rm') continue;
    const operands = unresolvedOperands(call.args);
    if (operands.length === 0) continue;
    return [
      `Refused: rm on ${operands.join(' ')}.`,
      'The Claude Code safety check cannot resolve that target, so it would stop for the owner even in full access.',
      'Delete with an explicit absolute path (rm -rf /tmp/x/*), or work in a fresh folder from mktemp -d instead of emptying one.',
    ].join(' ');
  }
  return undefined;
}
