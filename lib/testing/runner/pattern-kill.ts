import { program, readShell, type ShellWord } from '../../security/shell-words';

const REFUSAL =
  "Refused: killing processes by pattern can kill other agents' runs on the shared machine. Stop only a PID your own run recorded, or use the tool's own stop. Use a literal positive PID, %job, $!, or a variable assigned from $! in this command.";
const XARGS_VALUE_FLAGS = new Set([
  '-a',
  '-d',
  '-E',
  '-I',
  '-L',
  '-n',
  '-P',
  '-s',
  '--arg-file',
  '--delimiter',
  '--max-args',
  '--max-procs',
  '--max-chars',
  '--process-slot-var',
]);

/** Bash command wrappers run their utility; command -v/-V only describes it. */
function unwrappedProgram(words: ShellWord[]): ReturnType<typeof program> {
  let call = program(words);
  while (call && ['command', 'builtin'].includes(call.name)) {
    if (call.name === 'command' && call.args.some((arg) => /^-[vV]$/.test(arg.text))) return undefined;
    const start = call.args.findIndex((arg) => !arg.text.startsWith('-'));
    call = start < 0 ? undefined : program(call.args.slice(start));
  }
  return call;
}

/** Whether a kill operand names an explicit process or this command's recorded background PID. */
function recordedTarget(word: ShellWord, recorded: Set<string>): boolean {
  if (!word.expands) return /^0*[1-9]\d*$|^%(?:%|[\w+-]+)$/.test(word.text);
  if (word.text === '$!') return true;
  const variable = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})$/.exec(word.text);
  const name = variable?.[1] ?? variable?.[2];
  return name !== undefined && recorded.has(name);
}

/** Find xargs' utility past its options; later words may be plain text for printf or echo. */
function xargsUtility(args: ShellWord[]): ReturnType<typeof program> {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.text === '--') return unwrappedProgram(args.slice(index + 1));
    if (!arg.text.startsWith('-')) return unwrappedProgram(args.slice(index));
    if (XARGS_VALUE_FLAGS.has(arg.text)) index++;
  }
  return undefined;
}

/** Tier 1 shared-machine guard: process discovery never supplies a kill target. */
export function patternKillRefusal(command: string): string | undefined {
  const reading = readShell(command);
  if (!reading)
    return `${REFUSAL} The guard cannot read the heredoc delimiter. Write it plainly: <<EOF or <<'EOF'.`;
  const recorded = new Set<string>();
  for (const words of reading.commands) {
    const call = unwrappedProgram(words);
    if (!call && words.every((word) => /^[A-Za-z_]\w*=/.test(word.text))) {
      // Only standalone assignments persist. Do not infer bindings across subshells or pipelines.
      for (const word of words) {
        const [name, value] = word.text.split('=');
        if (!name) continue;
        if (word.expands && value === '$!' && !/[|()`]/.test(command) && !/\$!["']?\s*&/.test(command))
          recorded.add(name);
        else recorded.delete(name);
      }
      continue;
    }
    if (call?.name === 'pkill' || call?.name === 'killall') return REFUSAL;
    if (call?.name === 'xargs') {
      const utility = xargsUtility(call.args);
      if (utility && ['kill', 'pkill', 'killall'].includes(utility.name)) return REFUSAL;
    }
    if (call?.name !== 'kill') {
      // A builtin, function or sourced script may change a recorded binding.
      recorded.clear();
      continue;
    }
    const first = call.args[0]?.text;
    if (first === '-l' || first === '-L') continue;
    const signalArgs = first === '-s' || first === '-n' ? 2 : /^-[A-Za-z0-9]+$/.test(first ?? '') ? 1 : 0;
    const start = signalArgs + (call.args[signalArgs]?.text === '--' ? 1 : 0);
    const operands = call.args.slice(start);
    if (operands.length === 0 || operands.some((arg) => !recordedTarget(arg, recorded))) return REFUSAL;
  }
  return undefined;
}
