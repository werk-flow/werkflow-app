/**
 * Callback ref for an inline editor that the user's own click reveals (a
 * metadata field, a team name): focus follows that click into the field.
 * Never for a page or dialog that opens: a page keeps the browser's focus, a
 * dialog focuses its first control (jsx-a11y/no-autofocus).
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
}
