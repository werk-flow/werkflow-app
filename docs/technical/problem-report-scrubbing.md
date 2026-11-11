# Problem report scrubbing

Rules for what a problem report may carry once it leaves WerkFlow: the screenshot redraw on the device and the text scrubber on the server. The originals stay in WerkFlow's private storage; only a scrubbed copy may leave. [Security](security.md) owns the trust boundaries.

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

### Accepted limits of the redraw

- A record value that alone fills a text node and exactly equals one of the app's own UI words stays readable, such as a surname `Lager`. The owner accepted this.
- The redraw shows the visible viewport. Scrolled containers are shifted to their scroll position; the rest of a long page is not in the image. A sticky element inside a scrolled container shows where it sits unscrolled, and a fixed element inside one moves with it, so either may leave the image.
- A Radix state that only a library sets (such as `data-state="checked"`) is faked like any other value, so that element may render in its default state.

## Text scrubbing

The server keeps a scrubbed copy of each report's description and context beside the originals. Only this copy may leave WerkFlow as text. Nothing hands it out yet.

`lib/problem-reports/scrub/` holds the scrubber. `scrubStoredProblemReport(organizationId, reportId)` is its one entry. It reads the report inside that organization, reads the organization's dictionary, and writes the copy with its state through `record_problem_report_scrub` in one call. `submitProblemReport` runs it after its answer, so the receipt never waits for the scrub or fails with it. The daily run (`/api/problem-report-retention`) runs it for every report that has its originals and no copy, before it deletes anything: a report saved before the scrubber existed, one whose scrub never ran, and one whose last scrub failed.

### The dictionary

- The dictionary holds what the rows of the reporting organization name, and nothing of another organization. Every read filters by the organization. A scrub reads the dictionary anew and keeps nothing.
- Customer names come from the customers and from the callers of requests. Person names come from contacts, members, employees and their emergency contacts. Addresses come from customers, sites, callers and employees. Phone numbers come from all of these.
- A name is a term as a whole and word by word, so a surname alone is replaced. A word of fewer than three letters, and a function word (a salutation, a title, a legal form, an article, a preposition, a conjunction), is a term only inside its whole name. Without that, a customer called „Die Bad GmbH“ would replace every „die“.
- An address is a term in two parts: the street with its number, and the postcode with its city.
- The dictionary reads no email address, because the pattern rule replaces every one.

### Rules

Each rule has a test named after it in `lib/problem-reports/scrub/scrub-text.test.ts`, on the data of a made-up company. `lib/testing/fixtures/problem-report-scrub-boundaries.ts` drives the real submit action and the run.

1. **Placeholders.** A find becomes `[Kunde 1]`, `[Person 1]`, `[Adresse 1]`, `[Telefon 1]`, `[E-Mail 1]` or `[IBAN 1]`. Each type counts from 1 in text order. The same name or number takes the same placeholder throughout the text.
2. **Whole words.** A term matches whole words only. A name inside a longer word stays.
3. **Case and spelling.** Case never matters. `ä`, `ö`, `ü` and `ß` equal `ae`, `oe`, `ue` and `ss`. `Lindenstraße`, `Lindenstrasse` and `Lindenstr.` are one street, and `12a` equals `12 a`.
4. **Genitive.** A word also matches without its final `s`.
5. **Split terms.** Spaces, a line break, a dot, a comma or a hyphen may stand between the words of one term.
6. **Phone numbers.** A number that stands alone, starts with `+`, `00` or `0` and has at least 7 digits is replaced. Spaces, slashes, dashes and brackets may group its digits. The find ends where the groups end, so no group stays readable, and a second number right behind it belongs to the same find. Digits that spell a number of the dictionary are replaced too, with or without the leading zero. One number in two formats takes one placeholder.
7. **Email addresses.** Every address with a domain ending is replaced, with every character a local part may hold. A quoted local part reaches back to its opening quote.
8. **IBANs.** Every IBAN with a valid check is replaced, in one piece or in groups. A number that fails the check is replaced when only digits follow its first four characters.
9. **Salutations.** After „Herr“, „Herrn“, „Frau“, „Familie“ or „Fam.“, up to two capitalized words become a `[Person n]`, and after „Firma“ or „Fa.“ a `[Kunde n]`, even when the dictionary does not know them. A hyphenated double name counts as one word. „Dr.“ and „Prof.“ before the name are skipped.
10. **Overlaps.** Finds that overlap become one placeholder, so no part of either stays readable. Two known names that share a word, such as „Wei Li“ and „Li Na“ in „Wei Li Na“, are one find.
11. **Context.** The copy of the context keeps a control label only when the whole label is in the [UI string catalog](#the-ui-string-catalog). The server checks every label again, because it does not trust the device's filter. A stored context is copied only when it is the whole capture or an empty object. The schema of the capture bounds every other field: a route is a template, and an error name, an error code and the app version are tokens without spaces.
12. **Fails closed.** A dictionary read that fails, a dictionary above its row cap, a missing catalog and a scrub that throws leave no copy and the state `nicht_bereinigbar`. The report stays, and the daily run tries it again. A written copy never changes.
13. **One pass.** The terms sit in a tree keyed by word, and the scrub walks the words of the text once. No code loops over the names: the test with 10,000 customers counts the tree lookups against the words of the text. A term of more than twelve words enters the tree as every stretch of twelve words in a row, so no walk from a word goes deeper.

### Limits of the text scrubber

Not accepted: the owner's answer on werk-flow/werkflow-planning#21 is pending. The scrubbed copy keeps what neither the dictionary nor a pattern covers:

- a name the organization's data does not know and that follows no salutation, such as a neighbour, a nickname or a misspelt customer;
- a saluted name typed in lower case;
- a name of two letters alone;
- a street without its number, a city without its postcode, and the name of a site;
- an unknown phone number without a leading `0` or `+`.

The scrubber also replaces too much, which costs readability and never privacy. A name that is an ordinary word replaces that word everywhere, such as a customer called „Klein“. A date written `07-11-2026` has a phone number's shape.

## How to work

### Change the text scrubber

1. Change the rule in `lib/problem-reports/scrub/` and its test in `scrub-text.test.ts` together. A new rule gets its own test, named after the rule, on made-up data.
2. Prove the test fails with the rule removed, then passes.
3. A new source of names is one more read in `readDictionarySources`, filtered by the organization.
4. Run `bun run test:unit lib/problem-reports` and `bun run test:verify --group sql:problem-reports`.

Wrong turn: one regular expression per name. A company with 10,000 customers would run 10,000 searches over each report.

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
- Store, show or hand out a text as scrubbed that the scrubber did not write.
- Keep a dictionary across scrubs, or read it without the organization filter.
- Log a report's text, a name or a dictionary entry.

## Verify your work

Run `bun run test:unit lib/problem-reports`. For the redraw, also run `bun run test:ui problem-report-redraw` and the `audit:problem-reports:redraw` group. For the text scrubber, also run `bun run test:verify --group sql:problem-reports`.
