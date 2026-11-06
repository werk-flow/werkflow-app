import { createHash } from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';

const packageName = z.string().regex(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i);
const version = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i);
const advisoryUrl = z
  .string()
  .regex(/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i);
const severity = z.enum(['low', 'moderate', 'high', 'critical']);
const auditSchema = z.record(
  packageName,
  z
    .array(
      z.object({
        url: advisoryUrl,
        severity,
        vulnerable_versions: z.string().min(1),
      }),
    )
    .min(1),
);
const exceptionSchema = z
  .object({
    package: packageName,
    version,
    advisory: advisoryUrl,
    severity,
    paths: z.array(z.string().min(1)).min(1),
    reviewedOn: z.iso.date(),
    expiresOn: z.iso.date(),
    rationale: z.string().min(30),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
const dependencyPolicySchema = z
  .object({
    version: z.literal(1),
    dependencyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    exceptions: z.array(exceptionSchema),
  })
  .strict();
export type DependencyFinding = {
  package: string;
  version: string;
  path: string;
  advisory: string;
  severity: z.infer<typeof severity>;
  disposition: 'reviewed-exception' | 'blocked';
};
type AffectedInstall = Omit<DependencyFinding, 'disposition'>;
type DependencyException = z.infer<typeof exceptionSchema>;

export function dependencyDigest(manifest: string, lockfile: string): string {
  // Only dependency declarations affect this digest, not an unrelated script edit.
  const parsed: unknown = JSON.parse(manifest);
  const declarations = z
    .object({
      dependencies: z.unknown().optional(),
      devDependencies: z.unknown().optional(),
      optionalDependencies: z.unknown().optional(),
      overrides: z.unknown().optional(),
      resolutions: z.unknown().optional(),
    })
    .parse(parsed);
  return createHash('sha256')
    .update(JSON.stringify(declarations))
    .update(lockfile.replaceAll('\r\n', '\n'))
    .digest('hex');
}

function covers(exception: DependencyException, install: AffectedInstall): boolean {
  return (
    exception.package === install.package &&
    exception.version === install.version &&
    exception.advisory === install.advisory &&
    exception.severity === install.severity &&
    exception.paths.includes(install.path)
  );
}

function reviewWindowOpen(exception: DependencyException, today: string): boolean {
  return exception.reviewedOn <= today && today <= exception.expiresOn;
}

/**
 * A lapsed review and a review a finding outgrew fail, whether or not anything still matches.
 * Only an exception nothing needs any more is a note: the registry can narrow or withdraw an
 * advisory with no change here, and that good news must not turn every run red. A note is output
 * only. Dispositions never read it, and its expiry still ends it as a failure.
 */
function exceptionFollowUps(
  exceptions: readonly DependencyException[],
  findings: readonly DependencyFinding[],
  today: string,
): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  for (const exception of exceptions) {
    const label = `Exception ${exception.package}@${exception.version} (${exception.advisory})`;
    if (!reviewWindowOpen(exception, today)) {
      problems.push(
        `${label} is outside its review window, ${exception.reviewedOn} to ${exception.expiresOn}; review it again or remove it.`,
      );
    } else if (findings.some((finding) => covers(exception, finding))) {
      continue;
    } else if (
      findings.some(
        (finding) =>
          finding.disposition === 'blocked' &&
          finding.package === exception.package &&
          finding.advisory === exception.advisory,
      )
    ) {
      problems.push(`${label} no longer covers a current finding of that advisory; review it again.`);
    } else {
      notes.push(
        `${label} matches no current finding; remove it from lib/security/dependency-exceptions.json. After ${exception.expiresOn} it fails this check.`,
      );
    }
  }
  return { problems, notes };
}

export function inspectDependencyAudit(input: {
  stdout: string;
  exitCode: number;
  manifest: string;
  lockfile: string;
  policy: unknown;
  today: string;
}): { passed: boolean; findings: DependencyFinding[]; problems: string[]; notes: string[] } {
  // An exit code outside the audit's contract says more than the output it left behind.
  if (![0, 1].includes(input.exitCode)) throw new Error('Inconsistent audit completion');
  const audit = auditSchema.parse(JSON.parse(input.stdout));
  const policy = dependencyPolicySchema.parse(input.policy);
  const parsed = ts.parseConfigFileTextToJson('bun.lock', input.lockfile);
  if (parsed.error) throw new Error('Invalid Bun lockfile');
  const lock = z
    .object({
      lockfileVersion: z.literal(1),
      packages: z.record(z.string(), z.tuple([z.string()]).rest(z.unknown())),
    })
    .parse(parsed.config);
  if (
    (input.exitCode === 1 && !Object.keys(audit).length) ||
    (input.exitCode === 0 && Object.keys(audit).length > 0)
  )
    throw new Error('Inconsistent audit completion');
  const problems: string[] = [];
  const findings = new Map<string, DependencyFinding>();
  const digestMatches = policy.dependencyDigest === dependencyDigest(input.manifest, input.lockfile);
  const today = z.iso.date().parse(input.today);
  for (const [name, advisories] of Object.entries(audit)) {
    const installed = Object.entries(lock.packages).flatMap(([path, entry]) => {
      const prefix = `${name}@`;
      if (!entry[0].startsWith(prefix)) return [];
      return [{ path, version: version.parse(entry[0].slice(prefix.length)) }];
    });
    if (!installed.length) throw new Error('Advisory package missing from lockfile');
    for (const advisory of advisories) {
      const affected = installed.filter((entry) =>
        Bun.semver.satisfies(entry.version, advisory.vulnerable_versions),
      );
      if (!affected.length) throw new Error('Advisory range does not match locked versions');
      for (const entry of affected) {
        const install: AffectedInstall = {
          package: name,
          ...entry,
          advisory: advisory.url,
          severity: advisory.severity,
        };
        const exception = policy.exceptions.find((candidate) => covers(candidate, install));
        const reviewed = digestMatches && exception && reviewWindowOpen(exception, today);
        const finding: DependencyFinding = {
          ...install,
          disposition: reviewed ? 'reviewed-exception' : 'blocked',
        };
        findings.set(`${name}:${entry.version}:${entry.path}:${advisory.url}`, finding);
      }
    }
  }
  if (policy.exceptions.length && !digestMatches)
    problems.push(
      'Dependency declarations or lockfile changed; review exceptions against the new dependency tree.',
    );
  const current = [...findings.values()];
  const followUps = exceptionFollowUps(policy.exceptions, current, today);
  problems.push(...followUps.problems);
  return {
    passed: !problems.length && current.every((finding) => finding.disposition !== 'blocked'),
    findings: current,
    problems,
    notes: followUps.notes,
  };
}

export const DEPENDENCY_GATE_INPUTS = [
  'package.json',
  'bun.lock',
  'bunfig.toml',
  '.npmrc',
  'lib/testing/publication/dependency-audit.ts',
  'lib/security/dependency-exceptions.json',
  'scripts/check-dependency-security.ts',
] as const;
