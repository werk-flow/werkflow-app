'use client';

import { useRef } from 'react';

/**
 * One idempotency key per unchanged request: a retry of the same request
 * reuses its key, a changed request gets a fresh one.
 */
export function useRequestIdempotencyKey(): (request: unknown) => string {
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const requestSignatureRef = useRef('');
  return (request) => {
    const requestSignature = JSON.stringify(request);
    if (requestSignatureRef.current !== requestSignature) {
      requestSignatureRef.current = requestSignature;
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    return idempotencyKeyRef.current;
  };
}
