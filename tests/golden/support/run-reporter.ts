import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';

import {
  archiveRunOutputs,
  currentRunKey,
  ensureRunManifest,
  markRunFailed,
  readRunManifest,
  updateRunManifest,
  type RunFailure,
} from './run-state';

function failureFromError(title: string, file: string | null, error?: TestError): RunFailure {
  return {
    title,
    file,
    message: error?.message ?? 'Playwright reported an unexpected result without an error message.',
  };
}

export default class RunReporter implements Reporter {
  private total = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;

  onBegin(_config: FullConfig, suite: Suite): void {
    ensureRunManifest();
    this.total = suite.allTests().length;
    updateRunManifest(currentRunKey(), { status: 'running', total: this.total });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const unexpected = result.status !== test.expectedStatus;
    if (result.status === 'skipped') this.skipped += 1;
    else if (unexpected) this.failed += 1;
    else this.passed += 1;

    let failure: RunFailure | null = null;
    if (unexpected) {
      failure = failureFromError(test.titlePath().join(' > '), test.location.file, result.error);
      markRunFailed(failure);
    }
    updateRunManifest(currentRunKey(), (current) => ({
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      failures: failure ? [...current.failures, failure] : current.failures,
    }));
  }

  onError(error: TestError): void {
    ensureRunManifest();
    const failure = failureFromError('Playwright runner error', null, error);
    markRunFailed(failure);
    updateRunManifest(currentRunKey(), (current) => ({
      failures: [...current.failures, failure],
    }));
  }

  onEnd(result: FullResult): void {
    updateRunManifest(currentRunKey(), (current) => ({
      status:
        current.status === 'failed_retained'
          ? current.status
          : result.status === 'passed' && current.sourceRunKey
            ? 'diagnostic_passed'
            : result.status,
      completedAt: new Date().toISOString(),
    }));
  }

  async onExit(): Promise<void> {
    ensureRunManifest();
    try {
      archiveRunOutputs();
    } catch (error) {
      const failure = failureFromError('Run artifact archive', null, {
        message: error instanceof Error ? error.message : String(error),
      });
      markRunFailed(failure);
      updateRunManifest(currentRunKey(), (current) => ({
        status: 'failed',
        failures: [...current.failures, failure],
      }));
      process.stderr.write(`[werkflow-test] archiving failed: ${failure.message}\n`);
    }
    const manifest = readRunManifest(currentRunKey());
    const summary = `${manifest.status}: ${manifest.passed}/${manifest.total} passed, ${manifest.failed} failed`;
    process.stdout.write(`[werkflow-test] ${manifest.runKey} ${summary}\n`);
  }
}
