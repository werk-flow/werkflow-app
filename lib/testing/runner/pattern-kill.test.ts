// Rule test: an agent stops only explicit processes, never other agents' runs discovered by pattern.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { patternKillRefusal } from './pattern-kill';

const refused = [
  'pkill bun',
  'pkill -f "scripts/verify.ts run$"',
  'sudo /usr/bin/pkill -TERM -f verify',
  'killall bun',
  'killall -9 bun',
  'pgrep -f "scripts/verify.ts run$" | xargs -r kill',
  'pgrep verify | xargs kill',
  'ps aux | grep verify | xargs kill',
  'ps -eo pid,args | grep verify | awk "{print $1}" | xargs -r kill -TERM',
  'pgrep verify | kill',
  'kill $(pgrep verify)',
  'kill "$(pgrep -f verify)"',
  'kill `pgrep verify`',
  'kill $(ps aux | grep verify)',
  'kill "$pid"',
  'pid=$(pgrep verify); kill "$pid"',
  'run & pid=$!; pid=$(pgrep verify); kill "$pid"',
  'echo pid=$!; kill "$pid"',
  'kill -TERM 0',
  '/usr/bin/kill -TERM 4294967296',
  'kill 2147483648',
  'kill 99999999999999999999999999999',
  'false && pid=$!; kill "$pid"',
  'pid=$! marker=1 & kill "$pid"',
  'run & pid=$!; pid=$! marker=1 & kill "$pid"',
  `pid="$!"'' & kill "$pid"`,
  'pgrep verify | xargs -reI kill',
  'command kill "$pid" -v',
  'command -- kill "$pid" -V',
  'pgrep verify | xargs -rn 1 kill',
  'pgrep verify | xargs -rn1 kill',
  'pgrep verify | xargs -rIname kill name',
  '>/dev/null kill "$pid"',
  '> /dev/null pkill bun',
  '2>/dev/null command kill "$pid"',
  'kill 00',
  'kill 000',
  'pid=$! some_command; kill "$pid"',
  'run & pid=$!; export pid=0; kill "$pid"',
  'run & pid=$!; read pid; kill "$pid"',
  '(pid=$!); kill "$pid"',
  'pid=$! & kill "$pid"',
  'command kill "$pid"',
  'builtin kill "$pid"',
  'command pkill bun',
  'pgrep verify | xargs -n 1 command kill',
  'pgrep verify | xargs --replace kill {}',
  'pgrep verify | xargs -I {} kill {}',
  "cat <<$'EOF'\nbody\nEOF\npkill bun",
  'kill bun',
  'kill -TERM -1 123',
  'kill -- -1',
  'kill 123 "$other"',
];
const allowed = [
  'kill 123',
  'kill 00123',
  'kill 2147483647',
  'command -pv kill',
  'command -pV pkill',
  'command -- kill 123',
  '>/dev/null kill 123',
  "xargs -rn 1 printf '%s' 'kill'",
  'kill -s TERM -- 123',
  'kill %%',
  'kill -l',
  'command -v pkill',
  'command kill 123',
  'builtin kill "$!"',
  "xargs printf '%s\\n' 'kill'",
  'xargs -n 1 echo "pkill"',
  'kill -TERM 123',
  'kill -0 123',
  'kill %1',
  'kill "$!"',
  'kill $!',
  'kill -s TERM 123',
  'kill -- 123 456',
  'run & pid=$!; kill "$pid"',
  'run & pid="$!"; kill ${pid}',
  'echo "pkill bun; kill $(not_a_process_lookup)"',
  "printf '%s' 'pgrep verify | xargs kill'",
  'echo killall # pkill verify',
  '# kill $(pgrep verify)\necho done',
  'pgrep -f verify',
  "cat <<'EOF'\npkill bun\nEOF",
];

test('process discovery and unrecorded kill targets are refused', () => {
  for (const command of refused) expect(patternKillRefusal(command), command).toContain("other agents' runs");
});

test('literal targets, recorded background PIDs and quoted mentions pass', () => {
  for (const command of allowed) expect(patternKillRefusal(command), command).toBeUndefined();
});

test('the Bash hook enforces refusals with exit 2 and accepts other input', () => {
  const script = resolve(import.meta.dir, '../../../.claude/hooks/refuse-pattern-kill.ts');
  const call = (input: string) =>
    Bun.spawnSync({
      cmd: [process.execPath, script],
      stdin: Buffer.from(input),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  for (const command of [...refused, ...allowed]) {
    const result = call(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
    expect(result.exitCode, `${command}: ${result.stderr.toString()}`).toBe(
      refused.includes(command) ? 2 : 0,
    );
    if (result.exitCode === 2) expect(result.stderr.toString()).toContain("tool's own stop");
  }
  for (const input of ['not json', '{}', JSON.stringify({ tool_name: 'Edit', tool_input: {} })]) {
    const result = call(input);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  }
});
