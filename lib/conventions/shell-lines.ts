// The one Bash line reader of the convention tests that scan .github/scripts.

/**
 * The script's commands with each `\\` line continuation joined, numbered by their first line. A
 * full-line comment never continues: Bash ignores its trailing `\\` and runs the next line alone.
 */
export function logicalLines(script: string): { number: number; text: string }[] {
  const lines: { number: number; text: string }[] = [];
  let pending: { number: number; text: string } | undefined;
  for (const [index, line] of script.split('\n').entries()) {
    if (!pending && line.trimStart().startsWith('#')) {
      lines.push({ number: index + 1, text: line });
      continue;
    }
    const current = pending
      ? { number: pending.number, text: `${pending.text} ${line}` }
      : { number: index + 1, text: line };
    if (current.text.endsWith('\\')) pending = { number: current.number, text: current.text.slice(0, -1) };
    else {
      lines.push(current);
      pending = undefined;
    }
  }
  if (pending) lines.push(pending);
  return lines;
}
