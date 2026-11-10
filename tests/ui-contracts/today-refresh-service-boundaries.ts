// Stand-in for `@/lib/field-sync/device/today-refresh` as the start page's
// lazy import sees it. In the `today-refresh` fixture it is a chunk that a new
// deployment removed: loading it fails. Every other fixture gets the real code.
if (window.uiContractFixture === 'today-refresh')
  throw new TypeError('Failed to fetch dynamically imported module: today-refresh');

export { keepTodayFresh } from '@/lib/field-sync/device/today-refresh';
