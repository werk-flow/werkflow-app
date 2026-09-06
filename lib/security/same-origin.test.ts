import { describe, expect, test } from 'bun:test';
import { verifySameOriginJsonRequest } from './same-origin';

const url = 'https://app.werk-flow.app/auth/callback';

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers), url };
}

describe('verifySameOriginJsonRequest', () => {
  test('accepts a same-origin JSON request from a modern browser', () => {
    expect(
      verifySameOriginJsonRequest(
        request({
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
          origin: 'https://app.werk-flow.app',
        })
      )
    ).toEqual({ allowed: true });
  });

  test('accepts a JSON request without fetch metadata when the Origin matches', () => {
    expect(
      verifySameOriginJsonRequest(
        request({
          'content-type': 'application/json; charset=utf-8',
          origin: 'https://app.werk-flow.app',
        })
      )
    ).toEqual({ allowed: true });
  });

  test('rejects a cross-site request even when it claims JSON', () => {
    expect(
      verifySameOriginJsonRequest(
        request({
          'content-type': 'application/json',
          'sec-fetch-site': 'cross-site',
          origin: 'https://evil.example',
        })
      )
    ).toEqual({ allowed: false, reason: 'cross_site' });
  });

  test('rejects a foreign Origin without fetch metadata', () => {
    expect(
      verifySameOriginJsonRequest(
        request({ 'content-type': 'application/json', origin: 'https://evil.example' })
      )
    ).toEqual({ allowed: false, reason: 'origin_mismatch' });
  });

  test('rejects the text/plain form encoding used to smuggle JSON bodies', () => {
    expect(
      verifySameOriginJsonRequest(
        request({ 'content-type': 'text/plain', origin: 'https://app.werk-flow.app' })
      )
    ).toEqual({ allowed: false, reason: 'unsupported_content_type' });
  });
});
