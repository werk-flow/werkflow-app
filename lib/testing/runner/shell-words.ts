/**
 * A small shell reader for the agent hooks: it splits a command line into
 * simple commands and words, as far as a refusal needs. It runs nothing and
 * expands nothing; a word only records whether the shell would glob or expand it.
 */

/**
 * A shell word: its text without quotes, whether the shell would glob or expand
 * it, and the commands its `$(...)` or backtick substitutions run.
 */
export type ShellWord = { text: string; globs: boolean; expands: boolean; substitutions: string[] };

const OPERATORS = new Set([';', '&', '|', '(', ')', '\n']);
const GLOB_CHARACTERS = new Set(['*', '?', '[']);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Words before the program: shell keywords that open a command (`then rm ...`) and `sudo`. */
const PREFIXES = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'time', 'sudo']);
const REDIRECTION = /^\d*[<>]/;
const BARE_REDIRECTION = /^\d*[<>]+&?$/;
const HEREDOC = /(?<!<)<<-?\s*(["']?)([^\s"';&|<>()]+)\1/g;

/**
 * The command without its heredoc bodies, and the bodies the shell expands: a
 * body is data, but under an unquoted delimiter its substitutions run.
 */
export function splitHeredocs(command: string): { commands: string; expandingBodies: string[] } {
  const kept: string[] = [];
  const expandingBodies: string[] = [];
  let delimiters: { name: string; expands: boolean }[] = [];
  for (const line of command.split('\n')) {
    const [open] = delimiters;
    if (open) {
      if (line.trim() === open.name) delimiters = delimiters.slice(1);
      else if (open.expands) expandingBodies.push(line);
      continue;
    }
    kept.push(line);
    delimiters = [...line.matchAll(HEREDOC)].map((match) => ({ name: match[2] ?? '', expands: !match[1] }));
  }
  return { commands: kept.join('\n'), expandingBodies };
}

/** The command without its heredoc bodies, which are data, not commands. */
export function withoutHeredocBodies(command: string): string {
  return splitHeredocs(command).commands;
}

/** The index of the `)` that closes a `$(` whose body starts at `start`, or the text's end. */
function substitutionEnd(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    const character = text.charAt(index);
    if (character === '\\') index++;
    else if (character === "'" || character === '"') {
      const close = text.indexOf(character, index + 1);
      index = close === -1 ? text.length : close;
    } else if (character === '(') depth++;
    else if (character === ')' && --depth === 0) return index;
  }
  return text.length;
}

/** The index of the backtick that closes one opened before `start`, or the text's end. */
function backtickEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index++) {
    if (text.charAt(index) === '\\') index++;
    else if (text.charAt(index) === '`') return index;
  }
  return text.length;
}

/** The commands the `$(...)` and backtick substitutions in a heredoc body run; quotes there are literal. */
export function bodySubstitutions(body: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < body.length; index++) {
    const character = body.charAt(index);
    if (character === '\\') index++;
    else if (character === '$' && body.charAt(index + 1) === '(') {
      const end = substitutionEnd(body, index + 2);
      found.push(body.slice(index + 2, end));
      index = end;
    } else if (character === '`') {
      const end = backtickEnd(body, index + 1);
      found.push(body.slice(index + 1, end));
      index = end;
    }
  }
  return found;
}

/**
 * The simple commands of a shell line, split at operators, newlines and
 * parentheses. Quotes and backslashes are honored; a `#` that starts a word
 * comments out the rest of its line. Nested shells (`bash -c "..."`) stay one word.
 */
export function simpleCommands(command: string): ShellWord[][] {
  const commands: ShellWord[][] = [];
  let words: ShellWord[] = [];
  let word: ShellWord | undefined;
  let quote: '' | "'" | '"' = '';
  const current = (): ShellWord => (word ??= { text: '', globs: false, expands: false, substitutions: [] });
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
    const substitution =
      character === '$' && command.charAt(index + 1) === '('
        ? { start: index + 2, end: substitutionEnd(command, index + 2) }
        : character === '`'
          ? { start: index + 1, end: backtickEnd(command, index + 1) }
          : undefined;
    if (substitution) {
      // Outside single quotes a substitution runs its command, inside double quotes too.
      current().expands = true;
      current().substitutions.push(command.slice(substitution.start, substitution.end));
      current().text += command.slice(index, substitution.end + 1);
      index = substitution.end;
      continue;
    }
    if (character === '$') current().expands = true;
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

/** The program and arguments of a simple command, past leading variable assignments, keywords and `sudo`. */
export function program(words: ShellWord[]): { name: string; args: ShellWord[] } | undefined {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word.text) && !PREFIXES.has(word.text));
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
