import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies'

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await req.json()

    if (!orgId || typeof orgId !== 'string') {
      return NextResponse.json({ error: 'Invalid orgId' }, { status: 400 })
    }

    const cookieStore = await cookies()
    cookieStore.set(CURRENT_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CURRENT_ORG_MAX_AGE,
      path: '/'
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error setting org cookie:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}



