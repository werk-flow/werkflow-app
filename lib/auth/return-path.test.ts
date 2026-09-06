import { describe, expect, test } from 'bun:test';
import { resolveSafeReturnPath } from './return-path';

const origin = 'https://app.werk-flow.app';

describe('resolveSafeReturnPath', () => {
  test('keeps an ordinary relative path with query and hash', () => {
    expect(resolveSafeReturnPath('/auftraege?tab=offen#top', origin)).toBe(
      '/auftraege?tab=offen#top'
    );
  });

  test.each([
    ['.evil.example', 'host suffix'],
    ['@evil.example', 'userinfo separator'],
    [':8443@evil.example', 'port and userinfo'],
    ['//evil.example/x', 'protocol-relative'],
    ['/\\evil.example', 'backslash protocol-relative'],
    ['https://evil.example/', 'absolute foreign URL'],
    ['javascript:alert(1)', 'scheme'],
    ['', 'empty'],
  ])('falls back to / for %s (%s)', (candidate) => {
    expect(resolveSafeReturnPath(candidate, origin)).toBe('/');
  });

  test('falls back to / when the value is missing', () => {
    expect(resolveSafeReturnPath(null, origin)).toBe('/');
    expect(resolveSafeReturnPath(undefined, origin)).toBe('/');
  });
});
