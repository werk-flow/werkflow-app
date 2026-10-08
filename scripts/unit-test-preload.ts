import { setDefaultTimeout } from 'bun:test';

// bunfig.toml preloads this module into every `bun test` process, so a bare
// `bun test` and `bun run test:unit` share one hang guard. A unit test asserts
// no duration. Tests that read the whole source tree take two seconds on a
// quiet workstation and took up to thirteen right after a build, against
// Bun's default of five. Bun ignores a timeout in bunfig.toml, and this call
// overrides a `--timeout` flag.
setDefaultTimeout(60_000);
