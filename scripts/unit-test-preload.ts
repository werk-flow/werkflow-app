import { beforeEach, setDefaultTimeout } from 'bun:test';
import { openSync, writeSync } from 'node:fs';
import { UNIT_PROGRESS_ENVIRONMENT } from '../lib/testing/runner/unit-run-watchdog';
import { UNIT_TEST_TIMEOUT_MS } from './unit-test-timeout';

// bunfig.toml preloads this module into every `bun test` process. A unit test
// asserts no duration. Tests that read the whole source tree take two seconds
// on a quiet workstation and took up to thirteen right after a build, against
// Bun's default of five. Bun ignores a timeout in bunfig.toml, and in Bun
// 1.3.14 this call bounds only the first test file of a run, so
// scripts/run-unit-tests.ts also passes the same bound as `--timeout` for
// every file (a probe of three six-second tests failed two without it).
setDefaultTimeout(UNIT_TEST_TIMEOUT_MS);

// Under the runner, each test appends its file to the runner's progress file
// before it starts. The write is synchronous, so it lands even when the test
// then blocks the event loop. The variable is removed so a process a test
// starts does not report into the runner's file.
const progressFile = process.env[UNIT_PROGRESS_ENVIRONMENT];
delete process.env[UNIT_PROGRESS_ENVIRONMENT];
if (progressFile) {
  const progress = openSync(progressFile, 'a');
  beforeEach(() => {
    writeSync(progress, `${Bun.main}\n`);
  });
}
