// Runs once per environment (the storage adapter caches its configuration):
// the CSP storage origin equals the origin of the endpoint the adapter signs for.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

mock.module('server-only', () => ({}));
const { getR2Endpoint } = await import('@/lib/storage/r2');
const { storageOrigin } = await import('@/lib/security/csp-report');

assert.equal(storageOrigin(process.env), new URL(getR2Endpoint()).origin);
