import { keepTodayFresh as keepTodayFreshOnDevice } from '@/lib/field-sync/device/today-refresh';

export { dropTodayClaim } from '@/lib/field-sync/device/today-refresh';

// Stand-in for `@/lib/field-sync/device/today-refresh` as the start page's
// lazy import sees it. In the `today-refresh` fixture it is a chunk that a new
// deployment removed: loading it fails. Every other fixture gets the real code,
// and the spec can tell when the page handed it a person and organization.
if (window.uiContractFixture === 'today-refresh')
  throw new TypeError('Failed to fetch dynamically imported module: today-refresh');

declare global {
  interface Window {
    todayRefreshStarts: number;
    /** The organization of each hand-over, in order. */
    todayRefreshOrganizations: string[];
  }
}
window.todayRefreshStarts = 0;
window.todayRefreshOrganizations = [];

export const keepTodayFresh: typeof keepTodayFreshOnDevice = (...args) => {
  keepTodayFreshOnDevice(...args);
  window.todayRefreshStarts += 1;
  window.todayRefreshOrganizations.push(args[0].organizationId);
};
