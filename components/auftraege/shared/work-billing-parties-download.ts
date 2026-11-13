// The one download of the office-only billing section: the browser-only
// loader renders from it, and the office's job list starts it early, so a job
// opens without waiting for the chunk while the field worker never loads it.
export function downloadWorkBillingPartiesSection() {
  return import('./work-billing-parties-section').then((mod) => mod.WorkBillingPartiesSection);
}
