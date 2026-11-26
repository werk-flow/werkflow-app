import { setSystemTime } from 'bun:test';

// A unit test preloads this file by path into a CLI it spawns (`bun --preload <this file> <script>`),
// so the CLI reads noon in Berlin instead of the wall clock. Noon lies outside every window the CI
// clock rules know: the midnight start rule (lib/testing/runner/group-schedule.ts) holds a Browser
// job from 22:54:50 to 00:10 Berlin, and a CLI test on the wall clock failed every evening.
// Production never loads it.
setSystemTime(new Date('2026-11-26T11:00:00.000Z'));
