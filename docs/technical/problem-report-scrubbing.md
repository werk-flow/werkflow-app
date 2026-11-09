# Problem report scrubbing

Rules for what a problem report may carry once it leaves WerkFlow: the screenshot redraw on the device. The originals stay in WerkFlow's private storage; only a scrubbed copy may leave. [Security](security.md) owns the trust boundaries.

## Screenshot redraw

A report screenshot is never a picture of the page. The device redraws the visible page into a clone, rasterizes the clone, and only that image can leave the device. The redraw is default-deny: it keeps what it can prove belongs to the app and replaces everything else, so a new field can never slip through.

`lib/problem-reports/screenshot/` holds the redraw. `redrawScreenshot` is its one entry; a caller imports it lazily, so neither the redraw nor the catalog rides in a cold start.

### The UI string catalog

- The catalog holds the app's own UI strings: each string literal and JSX text of `app/`, `components/` and `lib/`, whitespace collapsed. Tests, `lib/testing/`, `fixtures/` folders, declarations, module paths and class names stay out (`extract-ui-strings.ts`).
- Example values and data lists stay out too, because a record can hold the same value. A placeholder shows an example (`Mustermann`), so no placeholder literal enters. A list of real places, such as the federal states of the holiday regions, is named in `DATA_LIST_DECLARATIONS`; a new list of that kind goes there, and a listed declaration that disappears fails the build.
- A text without a letter never enters the catalog and never matches it. Digits and punctuation alone are the shape of a phone number, a date or an amount.
- A literal stays whole. A text matches only when all of it equals one catalog entry, so a UI word inside a sentence of record data is faked with the rest.
- `next.config.ts` extracts the catalog whenever `next dev` or `next build` starts and inlines it into the redraw's lazy chunk. A build without the catalog fails the redraw; it never redraws with an empty catalog.

### Rules

Each rule has a test that fails without it: `tests/ui-contracts/problem-report-redraw.spec.ts`, on a synthetic page of a made-up company.

1. **Clone only.** The redraw reads the live page and builds the clone in a separate document. The live page never changes.
2. **Text.** A text node keeps its text only when the whole text is a catalog entry. Every other text becomes a fake of the same shape: each letter a made-up letter of the same case, each digit another digit; punctuation and spacing stay, so the layout holds. Fakes are random per redraw, so they cannot be mapped back.
3. **Form values.** Every input value, textarea, select option and `contenteditable` text is faked, whatever its text, and so is every text attribute inside a select, such as an option's label. A checked box stays checked; a hidden input is dropped.
4. **Attributes.** Layout and state attributes (`class`, `role`, `type`, `checked`, SVG geometry) stay verbatim. Attributes that load or link (`href`, `src`, `srcset`, `poster`, `action`, event handlers) are dropped. Every other attribute (`title`, `aria-*`, `alt`, `placeholder`, `value`, `data-*`, `id`) follows the text rule. An inline style loses each declaration with a `url()`, an image function, a quoted string or a CSS escape, which could spell either.
5. **Media.** Images, pictures, video, audio, canvas, embedded objects and every SVG with anything but shapes (text, an image, a foreign object, a reference) become neutral blocks of the same size. An icon drawn from shapes stays.
6. **Frames.** Iframes, scripts, templates and style elements are dropped.
7. **Styles.** A disabled sheet and a sheet for other media (print) stay out. A style sheet the build compiled from the source (same origin, under `/_next/static/`) stays verbatim, with its fonts inlined. Every other sheet, a style element included, may be written at runtime, so a detached copy of it gets the inline-style rule and loses its fonts. The live sheets never change.
8. **Rasterize on the device.** The clone and those styles become an SVG `foreignObject` drawn onto a canvas. An SVG drawn as an image loads nothing from the network. This needs `img-src data:` in the enforced content security policy (`lib/security/csp-report.ts`).

### Accepted limits

- A record value that alone fills a text node and exactly equals one of the app's own UI words stays readable, such as a surname `Lager`. The owner accepted this.
- The redraw shows the visible viewport. Scrolled containers are shifted to their scroll position; the rest of a long page is not in the image. A sticky element inside a scrolled container shows where it sits unscrolled, and a fixed element inside one moves with it, so either may leave the image.
- A Radix state that only a library sets (such as `data-state="checked"`) is faked like any other value, so that element may render in its default state.

## How to work

### Change the redraw

1. Change the rule in `lib/problem-reports/screenshot/redraw-page.ts` and its test in `tests/ui-contracts/problem-report-redraw.spec.ts` together. A new rule gets its own test, named after the rule.
2. Prove the test fails with the rule removed, then passes.
3. Run `bun run test:ui problem-report-redraw` and `bun run test:unit lib/problem-reports`.
4. Run the seeded journey with `bun run test:verify --group audit:problem-reports:redraw` and look at its images.

Wrong turn: keeping a text because it looks harmless. A rule that keeps by pattern (a status word, a label prefix) lets a record value through the moment it matches.

## Never

- Upload, store or show a screenshot the redraw did not produce.
- Keep a text, attribute or form value by partial match.
- Fall back to an empty catalog, or to a plain screenshot, when the redraw fails.
- Load an image, a font from another origin, or a frame into the clone.
- Import the redraw or the catalog statically from a page or a shared component.

## Verify your work

Run `bun run test:unit lib/problem-reports`, `bun run test:ui problem-report-redraw` and the `audit:problem-reports:redraw` group.
