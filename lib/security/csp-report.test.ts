import { expect, test } from 'bun:test';
import { CSP_REPORT_ONLY_POLICY, summarizeCspReport } from './csp-report';

test('a report keeps directive, blocked origin, document path and source, and drops the sample', () => {
  const violation = summarizeCspReport({
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

test('inline and eval markers survive; malformed bodies summarize to nothing', () => {
  expect(summarizeCspReport({ 'csp-report': { 'document-uri': 'https://app.werk-flow.app/login', 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline' } }))
    .toEqual({ directive: 'script-src-elem', blocked: 'inline', document: 'https://app.werk-flow.app/login', source: null, line: null, column: null });
  expect(summarizeCspReport({ 'csp-report': { 'document-uri': 'https://app.werk-flow.app/', 'effective-directive': 'script-src', 'blocked-uri': 'eval' } })?.blocked).toBe('eval');
  expect(summarizeCspReport(null)).toBeNull();
  expect(summarizeCspReport('text')).toBeNull();
  expect(summarizeCspReport({ 'csp-report': 'x' })).toBeNull();
  expect(summarizeCspReport({ 'csp-report': { 'effective-directive': 'script-src' } })).toBeNull();
});

test('the policy declares scripts, objects, base and form targets only and the legacy report channel', () => {
  expect(CSP_REPORT_ONLY_POLICY).toBe("script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report");
  expect(CSP_REPORT_ONLY_POLICY).not.toContain('default-src');
  expect(CSP_REPORT_ONLY_POLICY).not.toContain('unsafe-inline');
  expect(CSP_REPORT_ONLY_POLICY).not.toContain('report-to');
});
