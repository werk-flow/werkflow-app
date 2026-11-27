import { setSystemTime } from 'bun:test';

// A unit test preloads this file by path into a CLI it spawns (`bun --preload <this file> <script>`),
// so the CLI decides at noon in Berlin instead of on the wall clock (docs/technical/testing.md:
// never read the wall clock in a unit test). Noon lies outside the midnight start rule's hold
// (lib/testing/runner/group-schedule.ts), which from 22:54:50 to 00:10 Berlin made the scheduler's
// CLI tests fail every evening. The clock stands still, so never preload it into a CLI that waits
// for a deadline. Production never loads it.
setSystemTime(new Date('2026-11-26T11:00:00.000Z'));
