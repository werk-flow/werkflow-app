import { program, readShell, type ShellWord } from '../../security/shell-words';

const REFUSAL =
  "Refused: killing processes by pattern can kill other agents' runs on the shared machine. Stop only a PID your own run recorded, or use the tool's own stop. Use a literal PID, %job, $!, or a variable assigned from $! in this command.";

/** Whether a kill operand names an explicit process or this command's recorded background PID. */
function recordedTarget(word: ShellWord, recorded: Set<string>): boolean {
  if (!word.expands) return /^\d+$|^%[\w+-]+$/.test(word.text);
  if (word.text === '$!') return true;
  const variable = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})$/.exec(word.text);
  const name = variable?.[1] ?? variable?.[2];
  return name !== undefined && recorded.has(name);
}

/** Tier 1 shared-machine guard: process discovery never supplies a kill target. */
export function patternKillRefusal(command: string): string | undefined {
  const reading = readShell(command);
  // Match the delete hook's unreadable-input policy; quoted prose is not a command.
  if (!reading) return undefined;
  const recorded = new Set<string>();
  for (const words of reading.commands) {
    for (const word of words) {
      const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(word.text);
      const name = assignment?.[1];
      if (!name) break;
      if (word.expands && assignment?.[2] === '$!') recorded.add(name);
      else recorded.delete(name);
    }
    const call = program(words);
    if (!call) continue;
    if (call.name === 'pkill' || call.name === 'killall') return REFUSAL;
    // xargs obtains its operands from input, even when no target appears in its arguments.
    if (call.name === 'xargs' && call.args.some((arg) => /^(?:.*\/)?(?:kill|pkill|killall)$/.test(arg.text)))
      return REFUSAL;
    if (call.name !== 'kill') continue;
    const first = call.args[0]?.text;
    const signalArgs =
      first === '-s' || first === '-n' ? 2 : /^-(?:[A-Za-z0-9]+|-)$/.test(first ?? '') ? 1 : 0;
    const operands = call.args.slice(signalArgs);
    if (operands.length === 0 || operands.some((arg) => !recordedTarget(arg, recorded))) return REFUSAL;
  }
  return undefined;
}
