// The style rule of the redraw (docs/technical/problem-report-scrubbing.md):
// a declaration that can load an image or carry a text is dropped from every
// style the build did not compile from the source. A CSS escape can spell any
// of these functions (`\75rl(` is `url(`), so a value with a backslash goes too.

const UNSAFE_STYLE_VALUE = /url\(|src\(|image-set\(|image\(|element\(|cross-fade\(|["'\\]/iu;

/** Removes each declaration whose value names an image, holds a quoted string or escapes a character. */
export function removeUnsafeDeclarations(style: CSSStyleDeclaration): void {
  for (const property of Array.from(style)) {
    if (UNSAFE_STYLE_VALUE.test(style.getPropertyValue(property))) style.removeProperty(property);
  }
}
