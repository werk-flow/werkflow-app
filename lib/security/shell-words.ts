/**
 * A small shell reader for the agent hooks: it splits a command line into
 * simple commands and words, as far as a refusal needs. It runs nothing and
 * expands nothing; a word only records whether the shell would glob or expand it.
 */

/** A shell word: its text without quotes, and whether the shell would glob or expand it. */
export type ShellWord = { text: string; globs: boolean; expands: boolean };

const OPERATORS = new Set([';', '&', '|', '(', ')', '\n']);
const GLOB_CHARACTERS = new Set(['*', '?', '[']);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Words before the program: shell keywords that open a command (`then rm ...`) and `sudo`. */
const PREFIXES = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'time', 'sudo']);
const REDIRECTION = /^\d*[<>]/;
const BARE_REDIRECTION = /^\d*[<>]+&?$/;
const WORD_END = /[\s;&|<>()]/;

type Heredoc = { name: string; expands: boolean; stripsTabs: boolean };

/**
 * The heredoc a `<<` at `start` opens, and the index after its delimiter word,
 * or undefined when no delimiter follows. The delimiter is the word after
 * quote removal (`<<\EOF`, `<<'EOF'`, `<<"EOF"` and `<<E"OF"` all end at a
 * line `EOF`), and any quoting in it makes the body literal.
 */
function heredocAt(command: string, start: number): { heredoc: Heredoc; end: number } | undefined {
  let index = start + 2;
  const stripsTabs = command.charAt(index) === '-';
  if (stripsTabs) index++;
  while (command.charAt(index) === ' ' || command.charAt(index) === '\t') index++;
  let name = '';
  let quoted = false;
  while (index < command.length && !WORD_END.test(command.charAt(index))) {
    const character = command.charAt(index);
    if (character === '\\') {
      quoted = true;
      name += command.charAt(index + 1);
      index += 2;
    } else if (character === "'" || character === '"') {
      const close = command.indexOf(character, index + 1);
      if (close === -1) return undefined;
      quoted = true;
      name += command.slice(index + 1, close);
      index = close + 1;
    } else {
      name += character;
      index++;
    }
  }
  return name ? { heredoc: { name, expands: !quoted, stripsTabs }, end: index } : undefined;
}

/**
 * The command without its heredoc bodies, and the whole bodies the shell
 * expands: a body is data, but under an unquoted delimiter its substitutions
 * run. A `<<` counts only outside quotes, comments and arithmetic, and its body
 * starts on the line after it, so quoted text that spans lines hides nothing.
 * Where the reading is unsure, it errs toward commands: a body that never
 * reaches its delimiter is read as commands too.
 */
function splitHeredocs(command: string): { commands: string; expandingBodies: string[] } {
  const expandingBodies: string[] = [];
  let commands = '';
  let pending: Heredoc[] = [];
  let quote: '' | "'" | '"' = '';
  let comment = false;
  let index = 0;
  while (index < command.length) {
    const character = command.charAt(index);
    if (character === '\n' && !quote) {
      commands += character;
      index++;
      comment = false;
      for (const heredoc of pending) {
        const body: string[] = [];
        let closed = false;
        while (index < command.length && !closed) {
          const end = command.indexOf('\n', index);
          const line = command.slice(index, end === -1 ? command.length : end);
          index = end === -1 ? command.length : end + 1;
          closed = (heredoc.stripsTabs ? line.replace(/^\t+/, '') : line) === heredoc.name;
          if (!closed) body.push(line);
        }
        if (heredoc.expands || !closed) expandingBodies.push(body.join('\n'));
        if (!closed) commands += body.join('\n');
      }
      pending = [];
      continue;
    }
    const before = commands.charAt(commands.length - 1);
    if (!quote && !comment && character === '(' && command.charAt(index + 1) === '(') {
      // Arithmetic, `((...))` or `$((...))`: its `<<` is a shift, not a heredoc.
      const end = substitutionEnd(command, index + 1);
      commands += command.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    commands += character;
    index++;
    if (comment) continue;
    if (quote === "'") {
      if (character === "'") quote = '';
    } else if (character === '\\') {
      commands += command.charAt(index);
      index++;
    } else if (quote === '"') {
      if (character === '"') quote = '';
    } else if (character === "'" || character === '"') quote = character;
    else if (character === '#' && (before === '' || /[\s;&|()]/.test(before))) comment = true;
    else if (
      character === '<' &&
      before !== '<' &&
      command.charAt(index) === '<' &&
      command.charAt(index + 1) !== '<'
    ) {
      const opened = heredocAt(command, index - 1);
      if (opened) {
        pending.push(opened.heredoc);
        commands += command.slice(index, opened.end);
        index = opened.end;
      }
    }
  }
  return { commands, expandingBodies };
}

/**
 * Every simple command a shell line runs: its own, the ones in its `$(...)`
 * and backtick substitutions, quoted or not, and the substitutions of heredoc
 * bodies under an unquoted delimiter. Other heredoc bodies are data.
 */
export function executedCommands(command: string): ShellWord[][] {
  const { commands, expandingBodies } = splitHeredocs(command);
  return [
    ...simpleCommands(commands),
    ...expandingBodies.flatMap((text) => bodySubstitutions(text).flatMap((inner) => simpleCommands(inner))),
  ];
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
function bodySubstitutions(body: string): string[] {
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
 * parentheses, followed by those its substitutions run. Quotes and backslashes
 * are honored; a `#` that starts a word comments out the rest of its line.
 * Nested shells (`bash -c "..."`) stay one word.
 */
function simpleCommands(command: string): ShellWord[][] {
  const commands: ShellWord[][] = [];
  const substituted: ShellWord[][] = [];
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
    const substitution =
      character === '$' && command.charAt(index + 1) === '('
        ? { start: index + 2, end: substitutionEnd(command, index + 2) }
        : character === '`'
          ? { start: index + 1, end: backtickEnd(command, index + 1) }
          : undefined;
    if (substitution) {
      // Outside single quotes a substitution runs its command, inside double quotes too.
      current().expands = true;
      substituted.push(...simpleCommands(command.slice(substitution.start, substitution.end)));
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
  return [...commands, ...substituted].filter((simple) => simple.length > 0);
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
