// The one Bash line reader of the convention tests that scan .github/scripts.

/**
 * Whether Bash reads the line's last character as a `\\` line continuation, given the text joined
 * before it and the quote open at its start, and the quote open at its end. A backslash escapes
 * the next character outside single quotes, so `\\\\` ends no line; inside single quotes and after
 * a comment's `#` a trailing `\\` is plain text.
 */
function continues(
  line: string,
  before: string,
  quote: "'" | '"' | undefined,
): { continued: boolean; quote: "'" | '"' | undefined } {
  let open = quote;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (open === "'") {
      if (character === "'") open = undefined;
    } else if (character === '\\') {
      if (index === line.length - 1) return { continued: true, quote: open };
      index += 1;
    } else if (open === '"') {
      if (character === '"') open = undefined;
    } else if (character === "'" || character === '"') open = character;
    else if (
      character === '#' &&
      /^$|[\s;|&()<>]/.test(index === 0 ? before.slice(-1) : (line[index - 1] ?? ''))
    )
      break;
  }
  return { continued: false, quote: open };
}

/**
 * The script's commands with each `\\` line continuation joined as Bash joins it, with nothing in
 * between, numbered by their first line. Quote state carries across a continuation only; a quote
 * left open at a line's end is closed, as the scans read one command line at a time.
 */
export function logicalLines(script: string): { number: number; text: string }[] {
  const lines: { number: number; text: string }[] = [];
  let pending: { number: number; text: string; quote: "'" | '"' | undefined } | undefined;
  for (const [index, line] of script.split('\n').entries()) {
    const number = pending?.number ?? index + 1;
    const { continued, quote } = continues(line, pending?.text ?? '', pending?.quote);
    const text = (pending?.text ?? '') + (continued ? line.slice(0, -1) : line);
    if (continued) pending = { number, text, quote };
    else {
      lines.push({ number, text });
      pending = undefined;
    }
  }
  if (pending) lines.push({ number: pending.number, text: pending.text });
  return lines;
}
