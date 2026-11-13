# Problem report scrubbing

Rules for what a problem report may carry once it leaves WerkFlow: the screenshot redraw on the device and the text scrubber on the server. The originals and every attachment stay in WerkFlow's private storage; only the scrubbed copy and, when the report has one, the redrawn screenshot may leave. [Security](security.md) owns the trust boundaries.

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

### The reporter's boxes

The reporter then covers more (`lib/problem-reports/redaction.ts`). A box is kept as fractions of the image, so one drawn on the preview or the large view covers the same area. Only a copy with the boxes burned in at full size leaves the device. The cover is opaque by construction: a base fill, then stripes, in brand purples both themes share; a token that is not opaque gives black.

## Text scrubbing

The server keeps a scrubbed copy of each report's description and context beside the originals. Only this copy may leave WerkFlow as text, and only through the [hand-out](#hand-out).

`lib/problem-reports/scrub/` holds the scrubber. `scrubStoredProblemReport(organizationId, reportId)` is its one entry. It reads the report and its organization's dictionary, and writes the copy with its state and rule version through `record_problem_report_scrub` in one call. `submitProblemReport` runs it after its answer, so the receipt never waits for the scrub or fails with it. The daily run (`/api/problem-report-retention`) runs it, before it deletes anything, for every report that has its originals and no copy or a copy of older rules. The deletion periods bind, so the run deletes a due report's originals with or without a copy. A report without one then keeps no text at all, and the next run sets it `nicht_bereinigbar`.

### The dictionary

- The dictionary holds what the rows of the reporting organization name, and nothing of another organization. Every read filters by the organization.
- Customer names come from the organization's own name, the customers and the callers of requests. Person names come from contacts, members, employees and their emergency contacts. Addresses come from customers, sites, callers and employees. Site names come from the sites. Phone numbers come from all of these.
- A name is a term as a whole and word by word, so a surname alone is replaced. A word of fewer than three letters, and a function word (a salutation, a title, a legal form, an article, a preposition, a conjunction), is a term only inside its whole name. Without that, a customer called „Die Bad GmbH“ would replace every „die“. A short part before a word that is a term alone goes with it, so „O’Neill“ leaves no „O“. The apostrophes `'`, `’` and `ʼ` all separate two words.
- A word of a customer's name that is one of the app's own UI words is a term only inside the whole name. Reports are about the app: a customer called „Kältetechnik Service Nord“ must not turn every „Service“ into a placeholder. A UI word is a [catalog](#the-ui-string-catalog) entry of one word; a word inside a longer entry is none. A person's name has no such exception.
- A site's name is a term as its whole phrase, never word by word, with the `Adresse` placeholder. A site named with one UI word, such as „Hauptstandort“, is no term.
- An address is a term in its parts: the street with its number, the street alone, and the postcode with its city. The street alone is every stretch before a number, because a street's name may hold one („Straße des 17. Juni 5“). A street of one word counts alone only when it ends like a street: `straße`, `weg`, `platz`, `allee`, `gasse`, `ring`, `damm`, `ufer` or `chaussee`.
- The dictionary reads no email address, because the pattern rule replaces every one.

### Rules

Each rule has a test named after it in `lib/problem-reports/scrub/scrub-text.test.ts`, on the data of a made-up company. `lib/testing/fixtures/problem-report-scrub-boundaries.ts` drives the real submit action and the run.

1. **Placeholders.** A find becomes `[Kunde 1]`, `[Person 1]`, `[Adresse 1]`, `[Telefon 1]`, `[E-Mail 1]`, `[IBAN 1]` or `[ID 1]`. Each type counts from 1 in text order. The same name or number takes the same placeholder throughout the text.
2. **Whole words.** A term matches whole words only. A name inside a longer word stays.
3. **Case and spelling.** Case never matters. `ä`, `ö`, `ü` and `ß` equal `ae`, `oe`, `ue` and `ss`. `Lindenstraße`, `Lindenstrasse` and `Lindenstr.` are one street, and `12a` equals `12 a`.
4. **Genitive.** A word also matches without its final `s`.
5. **Split terms.** Whatever stands between two words never ends a term: spaces, a line break or any punctuation. A name split over two lines and a site stored as „Werkhalle (Neubau)“ are found.
6. **Phone numbers.** A number that stands alone, starts with `+`, `00` or `0` and has at least 7 digits is replaced. Any Unicode space, a slash, a dash or a bracket may group its digits. The find ends where the groups end, so no group stays readable, and a second number right behind it belongs to the same find. Digits that spell a number of the dictionary are replaced too, with or without the leading zero. One number in two formats takes one placeholder.
7. **Email addresses.** Every address with a domain ending is replaced, with every character a local part may hold and a combining mark on any letter. A quoted local part reaches back to its opening quote.
8. **IBANs.** Every IBAN with a valid check is replaced, in one piece or in groups separated by any Unicode space. A number that fails the check is replaced when only digits follow its first four characters.
9. **Record ids.** Every record id is replaced wherever it stands, also inside a longer word. The organization's join code becomes an `[ID n]` too, as a whole word in any case.
10. **Salutations.** After „Herr“, „Herrn“, „Frau“, „Familie“ or „Fam.“, up to two capitalized words become a `[Person n]`, and after „Firma“ or „Fa.“ a `[Kunde n]`, even when the dictionary does not know them. A double name joined by a hyphen or an apostrophe („O’Neill“) counts as one word. „Dr.“ and „Prof.“ before the name are skipped. When the next word is in lower case, as typed on a phone, that one word is the name, unless it has no letter or is a function word or an auxiliary such as „hat“ or „ist“.
11. **Overlaps.** Finds that overlap become one placeholder, so no part of either stays readable. Two known names that share a word, such as „Wei Li“ and „Li Na“ in „Wei Li Na“, are one find.
12. **Context.** The copy of the context keeps a control label only when the whole label is in the [UI string catalog](#the-ui-string-catalog). The server checks every label again, because it does not trust the device's filter. A stored context is copied only when it is the whole capture or an empty object. The app version and an error's name, code and digest are tokens without spaces. A token that the dictionary knows as a name or a phone number, or that holds a record id or the join code anywhere, is removed. No other pattern rule applies to a token, so a numeric digest stays. A route is a template and carries no value.
13. **Rule version.** Each copy carries the version of its rules, `SCRUB_RULES_VERSION` in `rule-version.ts`, which every rule that removes more raises. Only a current copy leaves; the daily run scrubs an older one again while its originals exist.
14. **Fails closed.** A dictionary read that fails, a dictionary above its row cap, a missing catalog and a scrub that throws leave no copy and the state `nicht_bereinigbar`. The report stays, and the daily run tries it again. A written copy changes only when a newer rule version writes it again from the originals; a failed scrub never removes one.
15. **One pass.** The terms sit in a tree keyed by word, and the scrub walks the words of the text once. No code loops over the names: the test with 10,000 customers counts the tree lookups against the words of the text. A term of more than twelve words enters the tree as every stretch of twelve words in a row, so no walk from a word goes deeper.

### Limits of the text scrubber

The owner accepted these limits (werk-flow/werkflow-planning#21). The scrubbed copy keeps what neither the dictionary nor a pattern covers:

- a name the organization's data does not know and that follows no salutation, such as a neighbour, a nickname or a misspelt customer;
- a name of two letters alone;
- a city without its postcode;
- an unknown phone number without a leading `0` or `+`;
- a lone word of a customer's name that is one of the app's own UI words, such as „Service“ or „Lager“;
- a word of a site's name alone, and a site named with one UI word;
- a street of one word without a street ending and without its number;
- a former name of the reporting organization: WerkFlow keeps no earlier names, so after a rename the dictionary knows only the current one.

These limits apply to every report thread that pulls a copy, and its model provider. The owner also accepted on 2026-11-12 that a handed-out copy outlives WerkFlow's deletion periods there, as the scrubbed copy counts as anonymous. Removing the hand-out secret stops further transfers; it recalls nothing.

The scrubber also replaces too much, which costs readability and never privacy. A name that is an ordinary word and no UI word replaces that word everywhere, such as a customer called „Klein“. A lower-case word after „frau“ or „herr“ that is no name is replaced too, such as „sagte“. A date written `07-11-2026` has a phone number's shape.

## Hand-out

The one door through which report content leaves WerkFlow. [Problem reports](../features/problem-reports.md#current-product-baseline) owns the four route handlers; `lib/problem-reports/handout.ts` holds what they read and write.

- **Who receives it.** Report threads outside WerkFlow, which pull with the bearer secret `PROBLEM_REPORT_HANDOUT_SECRET`. WerkFlow sends nothing on its own: no webhook, relay or outbound call. Without the secret the hand-out is off.
- **What leaves.** The waiting list: each report's id and bucket. A hand-out: the report's id, the scrubbed description and context, status, bucket, whether it has an answer, and the redrawn screenshot. Never an original, an attachment, support's answer (it is unscrubbed), a person, the organization or any other id.
- **Only a current scrubbed copy.** A report without a copy of the current [rule version](#rules-1) is neither listed nor handed out, and the hand-out answers only the checked copy revision.
- **Checked again.** The hand-out checks a current copy once more for the organization's name, its join code and record ids. A hit means the rules missed a case: `copy_unavailable`, an error logged without text, and the copy withdrawn for the daily run.
- **Once, accounted.** The hand-out and the screenshot each write a history entry, in the call that answers them, before anything leaves. The first hand-out claims the report, so each copy leaves to one thread once.
- **The screenshot goes through the server.** A signed storage address would carry the organization's id in its path, so the server reads the bytes and answers them itself.

## How to work

### Change the text scrubber

1. Change the rule in `lib/problem-reports/scrub/` and its test in `scrub-text.test.ts` together. A new rule gets its own test, named after the rule, on made-up data. A rule that removes more raises `SCRUB_RULES_VERSION`, so older copies are scrubbed again before they can leave.
2. Prove the test fails with the rule removed, then passes.
3. A new source of names is one more read in `readDictionarySources`, filtered by the organization.
4. Run `bun run test:unit lib/problem-reports` and `bun run test:verify --group sql:problem-reports`.

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
- Hand out a field the [hand-out](#hand-out) does not list, or push a report out of WerkFlow.
- Keep a dictionary across scrubs, or read it without the organization filter.
- Log a report's text, a name or a dictionary entry.

## Verify your work

Run `bun run test:unit lib/problem-reports`. For the hand-out or the text scrubber, also run `bun run test:verify --group sql:problem-reports`; for the redraw, `bun run test:ui problem-report-redraw` and the `audit:problem-reports:redraw` group; for the boxes, `bun run test:ui problem-report`.
