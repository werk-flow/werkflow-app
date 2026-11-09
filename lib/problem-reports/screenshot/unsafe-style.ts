// The style rule of the redraw (docs/technical/problem-report-scrubbing.md):
// a declaration that can load an image or carry a text is dropped from every
// style the build did not compile from the source.

const UNSAFE_STYLE_VALUE = /url\(|image-set\(|image\(|element\(|cross-fade\(|["']/iu;

/** Removes each declaration whose value names an image or holds a quoted string. */
export function removeUnsafeDeclarations(style: CSSStyleDeclaration): void {
  for (const property of Array.from(style)) {
    if (UNSAFE_STYLE_VALUE.test(style.getPropertyValue(property))) style.removeProperty(property);
  }
}
