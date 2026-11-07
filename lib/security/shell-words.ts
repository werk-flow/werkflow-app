/**
 * A small shell reader for the agent hooks: it splits a command line into
 * simple commands and words, as far as a refusal needs. It runs nothing and
 * expands nothing; a word only records whether the shell would glob or expand it.
 */

/**
 * A shell word: its text without quotes, whether the shell would glob or
 * expand it, and its raw source, an exact slice of the text it was read from.
 */
export type ShellWord = { text: string; globs: boolean; expands: boolean; raw: string };

/** Shells that run the script they read from their input when no `-c` script is given. */
export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const READS_SCRIPT = new Set([...SHELLS, 'source', '.']);
/** Programs that never run their arguments or their input as commands. */
export const DATA_PROGRAMS = new Set([
  'cat',
  'tee',
  'echo',
  'printf',
  'git',
  'gh',
  'grep',
  'rg',
  'jq',
  'head',
  'tail',
  'wc',
  'diff',
  'ls',
]);
/** A shell flag that hands the shell a script as an argument: `-c`, `-lc`, `-ec`. */
export const SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/;

const OPERATORS = new Set([';', '&', '|', '(', ')', '\n']);
const GLOB_CHARACTERS = new Set(['*', '?', '[']);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Words before the program: shell keywords that open a command (`then rm ...`) and `sudo`. */
const PREFIXES = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'time', 'sudo']);
const REDIRECTION = /^\d*[<>]/;
const BARE_REDIRECTION = /^\d*[<>]+&?$/;
const WORD_END = /[\s;&|<>()]/;

type Heredoc = { name: string; expands: boolean; stripsTabs: boolean };

/** Characters a backslash escapes inside double quotes; before any other, the backslash stays. */
const DOUBLE_QUOTE_ESCAPES = new Set(['"', '\\', '$', '`']);

/**
 * The heredoc a `<<` at `start` opens, and the index after its delimiter word;
 * `none` when no delimiter follows; `ambiguous` when the reader cannot tell
 * where the delimiter ends. The delimiter is the word after the shell's quote
 * removal (`<<\EOF`, `<<'EOF'`, `<<"EOF"`, `<<E"OF"` and `<<"E\"OF"` end at the
 * lines `EOF` and `E"OF`), and any quoting in it makes the body literal. An
 * unclosed quote, a quote or backslash that runs into the next line, and
 * `$'...'`, `$"..."`, `$(` or a backtick in the word are ambiguous.
 */
function heredocAt(command: string, start: number): { heredoc: Heredoc; end: number } | 'none' | 'ambiguous' {
  let index = start + 2;
  const stripsTabs = command.charAt(index) === '-';
  if (stripsTabs) index++;
  while (command.charAt(index) === ' ' || command.charAt(index) === '\t') index++;
  let name = '';
  let quoted = false;
  while (index < command.length && !WORD_END.test(command.charAt(index))) {
    const character = command.charAt(index);
    const next = command.charAt(index + 1);
    if (character === '\\') {
      if (next === '' || next === '\n') return 'ambiguous';
      quoted = true;
      name += next;
      index += 2;
    } else if (character === "'") {
      // Inside single quotes nothing is escaped.
      const close = command.indexOf("'", index + 1);
      const text = close === -1 ? '' : command.slice(index + 1, close);
      if (close === -1 || text.includes('\n')) return 'ambiguous';
      quoted = true;
      name += text;
      index = close + 1;
    } else if (character === '"') {
      quoted = true;
      index++;
      for (;;) {
        const inner = command.charAt(index);
        const escaped = command.charAt(index + 1);
        if (inner === '' || inner === '\n') return 'ambiguous';
        if (inner === '"') break;
        if (inner === '\\' && (escaped === '' || escaped === '\n')) return 'ambiguous';
        if (inner === '\\' && DOUBLE_QUOTE_ESCAPES.has(escaped)) {
          name += escaped;
          index += 2;
        } else {
          name += inner;
          index++;
        }
      }
      index++;
    } else if (character === '`' || (character === '$' && /['"(]/.test(next))) return 'ambiguous';
    else {
      name += character;
      index++;
    }
  }
  return name ? { heredoc: { name, expands: !quoted, stripsTabs }, end: index } : 'none';
}

/**
 * The command without its heredoc bodies, and the whole bodies the shell
 * expands: a body is data, but under an unquoted delimiter its substitutions
 * run. A `<<` counts only outside quotes, comments and arithmetic, and its body
 * starts on the line after it, so quoted text that spans lines hides nothing.
 * Where the reading is unsure, it errs toward commands: a body that never
 * reaches its delimiter is read as commands too. A delimiter it cannot read
 * makes the whole command unreadable: undefined.
 */
type HeredocBody = { text: string; expands: boolean; at: number };

function splitHeredocs(command: string): { commands: string; bodies: HeredocBody[] } | undefined {
  const bodies: HeredocBody[] = [];
  let commands = '';
  let pending: (Heredoc & { at: number })[] = [];
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
        if (closed) bodies.push({ text: body.join('\n'), expands: heredoc.expands, at: heredoc.at });
        else commands += body.join('\n');
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
      if (opened === 'ambiguous') return undefined;
      if (opened !== 'none') {
        pending.push({ ...opened.heredoc, at: commands.length - 2 });
        commands += command.slice(index, opened.end);
        index = opened.end;
      }
    }
  }
  return { commands, bodies };
}

/** The pipeline of a line around `offset`: its text between the separators `;`, `&&`, `||`, `&`, `(` and `)`. */
function pipelineAround(line: string, offset: number): string {
  let start = 0;
  let quote: '' | "'" | '"' = '';
  for (let index = 0; index < line.length; index++) {
    const character = line.charAt(index);
    if (quote === "'") {
      if (character === "'") quote = '';
      continue;
    }
    if (character === '\\') {
      index++;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = '';
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    const pair = line.slice(index, index + 2);
    const width =
      pair === '&&' || pair === '||'
        ? 2
        : ';()'.includes(character) ||
            (character === '&' && !'>|'.includes(line.charAt(index - 1)) && line.charAt(index + 1) !== '>')
          ? 1
          : 0;
    if (width === 0) continue;
    if (index >= offset) return line.slice(start, index);
    start = index + width;
    index += width - 1;
  }
  return line.slice(start);
}

/**
 * Who reads a heredoc body: a shell that runs it as a script (`bash <<EOF`,
 * `bash -s <<EOF`, `cat <<EOF | sh`), only programs that treat it as data
 * (`cat <<EOF > file`), or a program the reader cannot judge (`python3 - <<EOF`).
 */
function heredocReader(commands: string, at: number): 'shell' | 'data' | 'unknown' {
  const lineStart = commands.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = commands.indexOf('\n', at);
  const line = commands.slice(lineStart, lineEnd === -1 ? commands.length : lineEnd);
  const readers = simpleCommands(pipelineAround(line, at - lineStart)).map(program);
  if (
    readers.some(
      (reader) =>
        reader && READS_SCRIPT.has(reader.name) && !reader.args.some((arg) => SCRIPT_FLAG.test(arg.text)),
    )
  )
    return 'shell';
  return readers.length > 0 && readers.every((reader) => reader && DATA_PROGRAMS.has(reader.name))
    ? 'data'
    : 'unknown';
}

/**
 * What a shell line runs, as far as a guard needs: every simple command, its
 * own and those of its `$(...)` and backtick substitutions, quoted or not, the
 * substitutions of heredoc bodies under an unquoted delimiter, and the bodies a
 * shell reads as its script. A body only data programs read is data; a body
 * read by a program the reader cannot judge is unknown, and a guard decides.
 */
export type ShellReading = { commands: ShellWord[][]; dataBodies: string[]; unknownBodies: string[] };

/**
 * The reading of a shell line, or undefined when a heredoc delimiter is
 * ambiguous: a guard then refuses rather than guess which lines run. A data
 * body comes without its substitutions, which are among the commands.
 */
export function readShell(command: string, depth = 0): ShellReading | undefined {
  const split = splitHeredocs(command);
  if (!split) return undefined;
  const reading: ShellReading = {
    commands: simpleCommands(split.commands),
    dataBodies: [],
    unknownBodies: [],
  };
  for (const body of split.bodies) {
    const reader = heredocReader(split.commands, body.at);
    if (reader === 'shell') {
      const script = depth < 4 ? readShell(body.text, depth + 1) : undefined;
      if (!script) return undefined;
      reading.commands.push(...script.commands);
      reading.dataBodies.push(...script.dataBodies);
      reading.unknownBodies.push(...script.unknownBodies);
      continue;
    }
    if (body.expands)
      reading.commands.push(...bodySubstitutions(body.text).flatMap((inner) => simpleCommands(inner)));
    if (reader === 'data')
      reading.dataBodies.push(body.expands ? bodyWithoutSubstitutions(body.text) : body.text);
    else reading.unknownBodies.push(body.text);
  }
  return reading;
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

/**
 * The `$(...)` and backtick substitutions in a text, as the commands they run
 * and the text left without them. In a heredoc body quotes are literal; in a
 * raw word single quotes keep their text literal, as `simpleCommands` reads it.
 */
function splitSubstitutions(
  text: string,
  quoting: 'body' | 'word',
): { substitutions: string[]; rest: string } {
  const substitutions: string[] = [];
  let rest = '';
  let doubleQuoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (quoting === 'word' && character === '"') doubleQuoted = !doubleQuoted;
    if (quoting === 'word' && character === "'" && !doubleQuoted) {
      // In a word, single quotes keep `$(` literal, as the reader does.
      const close = text.indexOf("'", index + 1);
      const end = close === -1 ? text.length : close + 1;
      rest += text.slice(index, end);
      index = end - 1;
    } else if (character === '\\') {
      rest += text.slice(index, index + 2);
      index++;
    } else if (character === '$' && text.charAt(index + 1) === '(') {
      const end = substitutionEnd(text, index + 2);
      substitutions.push(text.slice(index + 2, end));
      index = end;
    } else if (character === '`') {
      const end = backtickEnd(text, index + 1);
      substitutions.push(text.slice(index + 1, end));
      index = end;
    } else rest += character;
  }
  return { substitutions, rest };
}

/** The commands the `$(...)` and backtick substitutions in a heredoc body run; quotes there are literal. */
function bodySubstitutions(body: string): string[] {
  return splitSubstitutions(body, 'body').substitutions;
}

/** A heredoc body without its substitutions, whose commands are read on their own. */
function bodyWithoutSubstitutions(body: string): string {
  return splitSubstitutions(body, 'body').rest;
}

/** A raw word without its `$(...)` and backtick substitutions, whose commands a guard reads on their own. */
export function wordWithoutSubstitutions(raw: string): string {
  return splitSubstitutions(raw, 'word').rest;
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
  let wordStart = 0;
  let position = 0;
  let quote: '' | "'" | '"' = '';
  const current = (): ShellWord => {
    if (!word) {
      word = { text: '', globs: false, expands: false, raw: '' };
      wordStart = position;
    }
    return word;
  };
  const endWord = () => {
    if (word) words.push({ ...word, raw: command.slice(wordStart, position) });
    word = undefined;
  };
  for (let index = 0; index < command.length; index++) {
    position = index;
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
  position = command.length;
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
export function withoutRedirections(args: readonly ShellWord[]): ShellWord[] {
  return args.filter(
    (arg, index) => !REDIRECTION.test(arg.text) && !BARE_REDIRECTION.test(args[index - 1]?.text ?? ''),
  );
}
