import { expect, test } from 'bun:test';
import { localMailpitUrl } from './local-mailpit';

test('Mailpit follows the local stack host, including Windows WSL NAT', () => {
  expect(localMailpitUrl('http://172.24.20.8:54321')?.origin).toBe('http://172.24.20.8:54324');
  expect(localMailpitUrl('http://127.0.0.1:54321')?.origin).toBe('http://127.0.0.1:54324');
});

test('cloud targets, other ports and private-looking DNS names never select Mailpit', () => {
  for (const address of [
    'https://mbkkzuqjbdvzelqvuzcn.supabase.co', 'http://172.24.evil.example:54321',
    'http://192.168.evil.example:54321', 'http://172.24.20.8:8000', 'https://127.0.0.1:54321',
  ]) expect(localMailpitUrl(address)).toBeNull();
});
