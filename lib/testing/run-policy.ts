export const PLAYWRIGHT_LANES = [
  'iteration',
  'certification',
  'diagnostic',
  'direct',
] as const;
export type PlaywrightLane = (typeof PLAYWRIGHT_LANES)[number];

export const PLAYWRIGHT_SUITES = ['golden', 'audit'] as const;
export type PlaywrightSuite = (typeof PLAYWRIGHT_SUITES)[number];

export const INCIDENT_CLASSES = ['product', 'harness', 'environment', 'transient'] as const;
export type IncidentClass = (typeof INCIDENT_CLASSES)[number];

export type RunRequest = {
  lane: PlaywrightLane;
  suite: PlaywrightSuite;
  grep: string | null;
  reuseRunKey: string | null;
};

export type CertificationAttempt = {
  runKey: string;
  status: 'passed' | 'failed';
  startedAt: string;
  classification: IncidentClass | null;
  classifiedAt: string | null;
};

export type FocusedVerification = {
  status: 'passed' | 'failed';
  startedAt: string;
  sourceFingerprint: string;
};

export function validateRunRequest(request: RunRequest): string[] {
  const errors: string[] = [];
  if (request.lane === 'iteration' && !request.grep?.trim()) {
    errors.push('Iteration runs require --grep. Use certification for a complete battery.');
  }
  if (request.lane === 'certification' && request.grep?.trim()) {
    errors.push('Certification runs cannot use --grep.');
  }
  if (request.lane === 'diagnostic') {
    if (!request.grep?.trim()) errors.push('Diagnostic runs require --grep.');
    if (!request.reuseRunKey) errors.push('Diagnostic runs require --reuse-run <run-key>.');
  } else if (request.reuseRunKey) {
    errors.push('--reuse-run is available only in diagnostic mode.');
  }
  return errors;
}

export function shouldRefreshStoredSession(
  savedAtMilliseconds: number,
  nowMilliseconds: number,
  expectedOrganizationMatches: boolean,
  maxAgeMilliseconds = 15 * 60 * 1000
): boolean {
  return (
    !expectedOrganizationMatches ||
    !Number.isFinite(savedAtMilliseconds) ||
    savedAtMilliseconds > nowMilliseconds ||
    nowMilliseconds - savedAtMilliseconds >= maxAgeMilliseconds
  );
}

export function evaluateFullCertificationRerun(input: {
  attemptsSinceLastPass: CertificationAttempt[];
  focusedVerifications: FocusedVerification[];
  currentSourceFingerprint: string;
  overrideReason: string | null;
}): { allowed: boolean; reason: string | null } {
  const failedAttempts = input.attemptsSinceLastPass.filter(
    (attempt) => attempt.status === 'failed'
  );
  const latestFailure = failedAttempts.at(-1);
  if (!latestFailure) return { allowed: true, reason: null };

  if (!latestFailure.classification || !latestFailure.classifiedAt) {
    return {
      allowed: false,
      reason: `Classify failed full run ${latestFailure.runKey} before another full certification.`,
    };
  }

  const classifiedAt = Date.parse(latestFailure.classifiedAt);
  const focusedProofExists = Number.isFinite(classifiedAt) && input.focusedVerifications.some(
    (verification) =>
      verification.status === 'passed' &&
      verification.sourceFingerprint === input.currentSourceFingerprint &&
      Date.parse(verification.startedAt) > classifiedAt
  );
  if (!focusedProofExists) {
    return {
      allowed: false,
      reason: `Run a focused verification on the current source after classifying ${latestFailure.runKey}.`,
    };
  }

  const repeatedClass =
    failedAttempts.length >= 2 &&
    failedAttempts.at(-2)?.classification === latestFailure.classification;
  if (repeatedClass && !input.overrideReason?.trim()) {
    return {
      allowed: false,
      reason: `The last two full runs failed in the ${latestFailure.classification} class. Investigate before overriding the rerun budget.`,
    };
  }

  return { allowed: true, reason: null };
}
