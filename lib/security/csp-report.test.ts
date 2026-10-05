import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  buildContentSecurityPolicy,
  buildReportOnlyContentSecurityPolicy,
  summarizeCspReport,
} from './csp-report';

const cloud = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  R2_ACCOUNT_ID: 'account',
};

test('a report keeps disposition, directive, blocked origin, document path and source, and drops the sample', () => {
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
      'original-policy': buildContentSecurityPolicy(cloud),
      disposition: 'report',
    },
  });
  expect(violation).toEqual({
    disposition: 'report',
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
  expect(
    summarizeCspReport({
      'csp-report': {
        'document-uri': 'https://app.werk-flow.app/login',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'inline',
        disposition: 'enforce',
      },
    }),
  ).toEqual({
    disposition: 'enforce',
    directive: 'script-src-elem',
    blocked: 'inline',
    document: 'https://app.werk-flow.app/login',
    source: null,
    line: null,
    column: null,
  });
  expect(
    summarizeCspReport({
      'csp-report': {
        'document-uri': 'https://app.werk-flow.app/',
        'effective-directive': 'script-src',
        'blocked-uri': 'eval',
        disposition: 'something else',
      },
    }),
  ).toMatchObject({ blocked: 'eval', disposition: null });
  expect(summarizeCspReport(null)).toBeNull();
  expect(summarizeCspReport('text')).toBeNull();
  expect(summarizeCspReport({ 'csp-report': 'x' })).toBeNull();
  expect(summarizeCspReport({ 'csp-report': { 'effective-directive': 'script-src' } })).toBeNull();
});

test('the enforced policy allows exactly the configured Supabase and object-storage origins', () => {
  expect(buildContentSecurityPolicy(cloud)).toBe(
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://project.supabase.co https://account.eu.r2.cloudflarestorage.com",
      "font-src 'self'",
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co https://account.eu.r2.cloudflarestorage.com",
      'frame-src https://account.eu.r2.cloudflarestorage.com',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'report-uri /api/csp-report',
    ].join('; '),
  );
  const policy = buildContentSecurityPolicy(cloud);
  expect(policy).not.toContain('unsafe-eval');
  expect(policy).not.toContain('report-to');
});

test('the local stack gets its http and ws origins, with the storage endpoint override', () => {
  const policy = buildContentSecurityPolicy({
    NEXT_PUBLIC_SUPABASE_URL: 'http://172.20.1.5:54321',
    R2_ACCOUNT_ID: 'local',
    R2_ENDPOINT: ' http://172.20.1.5:54321/storage/v1/s3 ',
  });
  expect(policy).toContain("connect-src 'self' http://172.20.1.5:54321 ws://172.20.1.5:54321;");
  expect(policy).toContain("img-src 'self' data: blob: http://172.20.1.5:54321;");
  expect(policy).toContain('frame-src http://172.20.1.5:54321;');
});

test('a missing or malformed origin is omitted, never written as undefined', () => {
  for (const env of [
    {},
    { NEXT_PUBLIC_SUPABASE_URL: 'not a url', R2_ENDPOINT: 'javascript:alert(1)' },
    { NEXT_PUBLIC_SUPABASE_URL: '   ', R2_ACCOUNT_ID: '' },
  ]) {
    const policy = buildContentSecurityPolicy(env);
    expect(policy).not.toMatch(/undefined|null|javascript/);
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("img-src 'self' data: blob:;");
    expect(policy).toContain("frame-src 'none';");
    expect(buildReportOnlyContentSecurityPolicy(env)).toContain("img-src 'self';");
  }
});

test('the report-only policy probes the unproven tightening on the same endpoint', () => {
  expect(buildReportOnlyContentSecurityPolicy(cloud)).toBe(
    [
      "img-src 'self' https://project.supabase.co https://account.eu.r2.cloudflarestorage.com",
      "worker-src 'none'",
      "manifest-src 'none'",
      "media-src 'none'",
      'report-uri /api/csp-report',
    ].join('; '),
  );
});

test('the storage origin is the origin the storage adapter signs URLs for', async () => {
  for (const env of [
    { R2_JURISDICTION: undefined, R2_ENDPOINT: undefined },
    { R2_JURISDICTION: '', R2_ENDPOINT: undefined },
    { R2_JURISDICTION: 'eu', R2_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3' },
  ]) {
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, '../testing/fixtures/csp-storage-origin.ts')],
      {
        cwd: resolve(import.meta.dir, '../..'),
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          R2_ACCOUNT_ID: 'account',
          R2_ACCESS_KEY_ID: 'synthetic',
          R2_SECRET_ACCESS_KEY: 'synthetic',
          R2_BUCKET_NAME: 'bucket',
          ...env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, `${JSON.stringify(env)}\n${stdout}\n${stderr}`).toBe(0);
  }
}, 30_000); // Three spawned Bun processes that load the S3 client; 5 s is not enough under host load.
