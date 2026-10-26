import { BERLIN_TIME_ZONE } from './lib/date-time/berlin';

/**
 * Runs once when a server process starts (Next.js instrumentation). WerkFlow has
 * one business time zone, and server code reads wall times through the process
 * zone in places (a server render of the calendar, manual time entries). Vercel
 * and CI run Node in UTC and Vercel reserves the TZ variable, so the process sets
 * its own zone before it serves a request; Node applies a changed TZ at once.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === 'nodejs') process.env.TZ = BERLIN_TIME_ZONE;
}
