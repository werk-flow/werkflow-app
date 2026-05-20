import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { AUTH_FLASH_COOKIE, isAuthFlashKey } from '@/lib/auth/flash';

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  const message = body?.message;

  if (!isAuthFlashKey(message)) {
    return NextResponse.json({ error: 'Invalid auth flash message.' }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_FLASH_COOKIE, message, getCookieOptions());

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_FLASH_COOKIE);

  return NextResponse.json({ success: true });
}
