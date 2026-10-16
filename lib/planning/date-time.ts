// Product code imports lib/date-time/berlin.ts. This path stays only for the
// measurement digest inputs that import it (tests/audit/performance/calendar.spec.ts,
// tests/audit/support/performance-profile.ts), whose content must not change
// outside a measured release. Delete it when those two imports move.
export { resolveBerlinWallTime } from '../date-time/berlin';
