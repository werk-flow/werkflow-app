/**
 * How long a phone without a stored day waits for the start page's first refresh before it says
 * the day is not on the phone. E7's refresh reports only a saved day; one that ends on a server
 * error tells no one (werk-flow/werkflow-planning#22), so the wait is bounded.
 */
export const FIRST_REFRESH_WAIT_MS = 15_000;
