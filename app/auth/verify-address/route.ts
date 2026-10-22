import { NextResponse, type NextRequest } from 'next/server';

import {
  addressSchema,
  VERIFY_ADDRESS_COOKIE,
  VERIFY_ADDRESS_COOKIE_OPTIONS,
} from '@/lib/auth/address-cookies';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { z } from '@/lib/zod';

const bodySchema = z.object({ email: addressSchema });

// The signup and the login of an unconfirmed account leave the address for
// the code step here, before they open /verify: the address stays out of the
// URL. The visitor has no session yet, and the cookie only prefills the code
// step in this browser, so the same-origin guard is the whole check.
export async function POST(req: NextRequest) {
  const verdict = verifySameOriginJsonRequest(req);
  if (!verdict.allowed) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(VERIFY_ADDRESS_COOKIE, parsed.data.email, VERIFY_ADDRESS_COOKIE_OPTIONS);
  return res;
}
