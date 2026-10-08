import { setDefaultTimeout } from 'bun:test';
import { UNIT_TEST_TIMEOUT_MS } from './unit-test-timeout';

// bunfig.toml preloads this module into every `bun test` process. A unit test
// asserts no duration. Tests that read the whole source tree take two seconds
// on a quiet workstation and took up to thirteen right after a build, against
// Bun's default of five. Bun ignores a timeout in bunfig.toml, and in Bun
// 1.3.14 this call bounds only the first test file of a run, so
// scripts/run-unit-tests.ts also passes the same bound as `--timeout` for
// every file (a probe of three six-second tests failed two without it).
setDefaultTimeout(UNIT_TEST_TIMEOUT_MS);
