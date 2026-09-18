import { expect, test } from 'bun:test';
import { CSP_REPORT_MAX_VIOLATIONS, CSP_REPORT_ONLY_POLICY, summarizeCspReports } from './csp-report';

test('a legacy report keeps directive, blocked origin, document path and source, and drops the sample', () => {
  const [violation, ...rest] = summarizeCspReports({
    'csp-report': {
      'document-uri': 'https://app.werk-flow.app/kunden?search=Meier#top',
      'violated-directive': 'script-src',
      'effective-directive': 'script-src',
      'blocked-uri': 'https://cdn.example.com/widget.js?key=abc',
      'source-file': 'https://app.werk-flow.app/_next/static/chunks/app.js?v=1',
      'line-number': 12,
      'column-number': 7,
      'script-sample': 'self.__next_f.push([1,"Meier GmbH"])',
      'original-policy': CSP_REPORT_ONLY_POLICY,
    },
  });
  expect(rest).toEqual([]);
  expect(violation).toEqual({
    directive: 'script-src',
    blocked: 'https://cdn.example.com',
    document: 'https://app.werk-flow.app/kunden',
    source: 'https://app.werk-flow.app/_next/static/chunks/app.js',
    line: 12,
    column: 7,
  });
  expect(JSON.stringify(violation)).not.toContain('Meier');
});

test('a Reporting API batch keeps csp-violation entries, inline markers and nothing else', () => {
  const violations = summarizeCspReports([
    { type: 'csp-violation', body: { documentURL: 'https://app.werk-flow.app/login', effectiveDirective: 'script-src-elem', blockedURL: 'inline', sample: 'secret' } },
    { type: 'deprecation', body: { documentURL: 'https://app.werk-flow.app/login' } },
    { type: 'csp-violation', body: { effectiveDirective: 'script-src' } },
  ]);
  expect(violations).toEqual([{ directive: 'script-src-elem', blocked: 'inline', document: 'https://app.werk-flow.app/login', source: null, line: null, column: null }]);
});

test('malformed bodies summarize to nothing and batches are bounded', () => {
  expect(summarizeCspReports(null)).toEqual([]);
  expect(summarizeCspReports('text')).toEqual([]);
  expect(summarizeCspReports({ 'csp-report': 'x' })).toEqual([]);
  const batch = Array.from({ length: CSP_REPORT_MAX_VIOLATIONS + 5 }, () => ({ type: 'csp-violation', body: { documentURL: 'https://app.werk-flow.app/', effectiveDirective: 'script-src', blockedURL: 'eval' } }));
  expect(summarizeCspReports(batch)).toHaveLength(CSP_REPORT_MAX_VIOLATIONS);
});

test('the policy declares scripts, objects, base and form targets only and both report channels', () => {
  expect(CSP_REPORT_ONLY_POLICY).toBe("script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report; report-to csp-reports");
  expect(CSP_REPORT_ONLY_POLICY).not.toContain('default-src');
  expect(CSP_REPORT_ONLY_POLICY).not.toContain('unsafe-inline');
});
