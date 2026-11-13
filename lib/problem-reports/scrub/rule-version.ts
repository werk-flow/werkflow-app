/**
 * The version of the scrub rules, written with each copy
 * (docs/technical/problem-report-scrubbing.md, "Rule version"). Raise it with
 * every rule that removes more: only a copy of the current version leaves
 * WerkFlow, and the daily run scrubs every older copy again while its
 * originals exist.
 */
export const SCRUB_RULES_VERSION = 1;
