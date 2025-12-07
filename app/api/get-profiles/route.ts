import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userIds } = body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ profiles: {} });
    }

    const admin = createSupabaseAdminClient();

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', userIds);

    if (error) {
      console.error('Error fetching profiles:', error);
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }

    // Convert to a map for easy lookup
    const profileMap: Record<
      string,
      { firstName: string | null; lastName: string | null }
    > = {};

    for (const profile of profiles || []) {
      profileMap[profile.id] = {
        firstName: profile.first_name,
        lastName: profile.last_name
      };
    }

    return NextResponse.json({ profiles: profileMap });
  } catch (error) {
    console.error('Error in /api/get-profiles:', error);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
