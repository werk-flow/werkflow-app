import { describe, expect, test } from 'bun:test';
import { findBrokenLinks, type LinkResolver } from './doc-links';

const files = new Map([
  ['/docs/README.md', new Set(['maintenance-rules'])],
  ['/docs/technical/security.md', new Set(['how-to-work'])],
]);
const resolver: LinkResolver = {
  resolve: (target) => (target === '' ? '/docs/README.md' : `/docs/${target}`),
  exists: (path) => files.has(path) || path === '/docs/assets/a.png',
  inMissingSibling: (path) => path.startsWith('/docs/../../werkflow-business'),
  anchors: (path) => files.get(path) ?? new Set(),
};

describe('doc links', () => {
  test('existing files, their headings, own anchors, assets and external links pass', () => {
    const markdown =
      '[a](technical/security.md#how-to-work) [b](#maintenance-rules) [c](assets/a.png) [d](https://x.example) [e](mailto:x@example.com)';
    expect(findBrokenLinks(markdown, resolver)).toEqual([]);
  });

  test('probe: a missing file and a missing heading fail; a missing sibling clone is counted elsewhere', () => {
    expect(
      findBrokenLinks(
        '[a](technical/gone.md) [b](technical/security.md#renamed) [c](../../werkflow-business/docs/x.md) [d](technical/security.md#%E0%A4%A)',
        resolver,
      ),
    ).toEqual([
      'technical/gone.md does not resolve',
      "technical/security.md#renamed names no heading of the target; use the heading's slug or drop the fragment",
      'technical/security.md#%E0%A4%A carries a malformed percent-encoded fragment',
    ]);
  });
});
