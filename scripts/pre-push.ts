import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The logic of .githooks/pre-push (docs/technical/testing.md, "Publication gate"). It pipes git's
 * ref list into scripts/check-publication-gate.ts and refuses the push unless the gate passes or
 * the owner's override (WERKFLOW_PUSH_OVERRIDE="<reason>") is logged. It calls no shell utility,
 * so the hook works from any shell whose PATH reaches bun and git (lib/testing/publication/pre-push-hook.test.ts).
 */
const repository = resolve(import.meta.dir, '..');
const OVERRIDE_LOG = '.agent-logs/review/overrides.log';

/** One log field: a line break or tab would split the record, so each becomes a space. */
function logField(text: string): string {
  return text.replace(/[\n\t]/g, ' ');
}

/** The override record: UTC time to the second, the pushed HEAD, the reason, the refused gate's output. */
function writeOverrideRecord(reason: string, gateOutput: string): boolean {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    const time = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    mkdirSync(resolve(repository, '.agent-logs/review'), { recursive: true });
    appendFileSync(
      resolve(repository, OVERRIDE_LOG),
      `${[time, head, logField(reason), logField(gateOutput)].join('\t')}\n`,
    );
    return true;
  } catch (error) {
    process.stderr.write(`[publication-gate] ${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  }
}

const gate = Bun.spawnSync({
  cmd: [process.execPath, 'scripts/check-publication-gate.ts'],
  cwd: repository,
  stdin: new TextEncoder().encode(await Bun.stdin.text()),
  stdout: 'pipe',
  stderr: 'pipe',
});
const output = `${gate.stdout.toString()}${gate.stderr.toString()}`.replace(/\n+$/, '');

if (gate.exitCode === 0) {
  process.stdout.write(`${output}\n`);
  process.exit(0);
}
process.stderr.write(`${output}\n`);

const override = process.env.WERKFLOW_PUSH_OVERRIDE ?? '';
if (!override) process.exit(1);
// An override that leaves no record is refused, so every bypass stays visible.
if (!writeOverrideRecord(override, output)) {
  process.stderr.write(`[publication-gate] Owner override refused: ${OVERRIDE_LOG} could not be written.\n`);
  process.exit(1);
}
process.stderr.write(`[publication-gate] Owner override logged to ${OVERRIDE_LOG}: ${override}\n`);
