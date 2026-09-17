import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectDependencyAudit } from '../lib/testing/dependency-audit';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';

const root = process.cwd();
const reportPath = resolve(root, '.agent-logs/security/dependencies', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`);
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

await withWorkspaceTestLock({ operation: 'dependency security audit' }, async () => {
  const startedAt = new Date().toISOString();
  const child = Bun.spawn([process.execPath, 'audit', '--json'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  });
  const deadline = setTimeout(() => child.kill(), 60000);
  try {
    // Discard diagnostic text after bounded draining; never persist arbitrary registry responses.
    const [stdout, , exitCode] = await Promise.all([readBounded(child.stdout), readBounded(child.stderr), child.exited]);
    const result = inspectDependencyAudit({
      stdout, exitCode,
      manifest: readFileSync(resolve(root, 'package.json'), 'utf8'),
      lockfile: readFileSync(resolve(root, 'bun.lock'), 'utf8'),
      policy: JSON.parse(readFileSync(resolve(root, 'lib/security/dependency-exceptions.json'), 'utf8')),
      today: startedAt.slice(0, 10),
    });
    const blocked = result.findings.filter((finding) => finding.disposition === 'blocked');
    const passed = blocked.length === 0 && result.problems.length === 0;
    writeFileSync(reportPath, JSON.stringify({ startedAt, completedAt: new Date().toISOString(), status: passed ? 'passed' : 'failed', ...result }, null, 2));
    console.log(`[security:dependencies] ${passed ? 'passed' : 'failed'}; ${blocked.length} unreviewed affected installations; ${result.findings.length - blocked.length} reviewed exceptions; report ${reportPath}`);
    for (const finding of blocked) console.log(`${finding.package}@${finding.version}: ${finding.advisory}`);
    process.exitCode = passed ? 0 : 1;
  } catch {
    child.kill();
    await child.exited;
    writeFileSync(reportPath, JSON.stringify({ startedAt, completedAt: new Date().toISOString(), status: 'blocked', reason: 'Audit unavailable, timed out, malformed, or incompatible with its lockfile/policy. No security result was accepted.' }, null, 2));
    console.error(`[security:dependencies] blocked; report ${reportPath}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}).catch(() => {
  writeFileSync(reportPath, JSON.stringify({ completedAt: new Date().toISOString(), status: 'blocked',
    reason: 'Audit process or workspace lock could not start. No security result was accepted.' }, null, 2));
  console.error(`[security:dependencies] blocked; report ${reportPath}`);
  process.exitCode = 1;
});
