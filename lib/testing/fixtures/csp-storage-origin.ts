// Runs once per environment (the storage adapter caches its configuration):
// the CSP storage origin equals the origin of the endpoint the adapter signs for.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

mock.module('server-only', () => ({}));
const { getR2Endpoint } = await import('@/lib/storage/r2');
const { buildContentSecurityPolicy } = await import('@/lib/security/csp-report');

// The policy frames exactly the storage origin, so its frame-src names that origin.
const frameSource = buildContentSecurityPolicy(process.env)
  .split('; ')
  .find((directive) => directive.startsWith('frame-src '));
assert.equal(frameSource, `frame-src ${new URL(getR2Endpoint()).origin}`);
