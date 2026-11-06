import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectDependencyAudit } from '../lib/testing/publication/dependency-audit';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

const root = process.cwd();
const reportPath = resolve(
  root,
  '.agent-logs/security/dependencies',
  `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`,
);
mkdirSync(resolve(reportPath, '..'), { recursive: true });

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.length;
    if (length > 8 * 1024 * 1024) throw new Error('Audit output exceeded its limit');
    chunks.push(result.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * scripts/verify.ts keeps a group's output in a log that CI uploads only on failure, so a passing
 * check reaches a reader through the job summary. A summary that cannot be written fails no gate.
 */
function publishNotes(notes: readonly string[]): void {
  for (const note of notes) console.log(`[security:dependencies] note: ${note}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary || !notes.length) return;
  try {
    const items = notes.map((note) => `- ${note}\n`).join('');
    appendFileSync(summary, `### Dependency exceptions to clean up\n\n${items}\n`);
  } catch {
    console.error('[security:dependencies] the job summary could not take the notes');
  }
}

await withWorkspaceTestLock({ operation: 'dependency security audit' }, async () => {
  const startedAt = new Date().toISOString();
  const child = Bun.spawn([process.execPath, 'audit', '--json'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  const deadline = setTimeout(() => child.kill(), 60000);
  try {
    // Discard diagnostic text after bounded draining; never persist arbitrary registry responses.
    const [stdout, , exitCode] = await Promise.all([
      readBounded(child.stdout),
      readBounded(child.stderr),
      child.exited,
    ]);
    const result = inspectDependencyAudit({
      stdout,
      exitCode,
      manifest: readFileSync(resolve(root, 'package.json'), 'utf8'),
      lockfile: readFileSync(resolve(root, 'bun.lock'), 'utf8'),
      policy: JSON.parse(readFileSync(resolve(root, 'lib/security/dependency-exceptions.json'), 'utf8')),
      today: startedAt.slice(0, 10),
    });
    const blocked = result.findings.filter((finding) => finding.disposition === 'blocked');
    const { passed, ...evidence } = result;
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          startedAt,
          completedAt: new Date().toISOString(),
          status: passed ? 'passed' : 'failed',
          ...evidence,
        },
        null,
        2,
      ),
    );
    console.log(
      `[security:dependencies] ${passed ? 'passed' : 'failed'}; ${blocked.length} unreviewed affected installations; ${result.findings.length - blocked.length} reviewed exceptions; ${result.notes.length} cleanup notes; report ${reportPath}`,
    );
    for (const finding of blocked) console.log(`${finding.package}@${finding.version}: ${finding.advisory}`);
    for (const problem of result.problems) console.log(problem);
    publishNotes(result.notes);
    process.exitCode = passed ? 0 : 1;
  } catch {
    child.kill();
    await child.exited;
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          startedAt,
          completedAt: new Date().toISOString(),
          status: 'blocked',
          reason:
            'Audit unavailable, timed out, malformed, or incompatible with its lockfile/policy. No security result was accepted.',
        },
        null,
        2,
      ),
    );
    console.error(`[security:dependencies] blocked; report ${reportPath}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}).catch(() => {
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        status: 'blocked',
        reason: 'Audit process or workspace lock could not start. No security result was accepted.',
      },
      null,
      2,
    ),
  );
  console.error(`[security:dependencies] blocked; report ${reportPath}`);
  process.exitCode = 1;
});
