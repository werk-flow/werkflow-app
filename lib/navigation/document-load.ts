/**
 * Leaves the current page with a full document load instead of a router
 * navigation. Use it only where the next page must start from fresh cookies
 * and an empty client state: after sign-in, sign-out or an account deletion,
 * after the active organization changed, after a deletion whose detail page
 * would otherwise redirect first and drop the banner parameter, after a field
 * work pack turned read-only (the page reloads in its locked state), and for a
 * non-page target (tel:, mailto:, a signed file URL). Every other internal
 * navigation goes through `useRouter().push()`, which Next's
 * `no-location-assign-relative-destination` rule enforces for literal paths.
 */
export function loadDocument(url: string): void {
  window.location.assign(url);
}
