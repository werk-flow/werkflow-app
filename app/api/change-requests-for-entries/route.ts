import { NextResponse } from 'next/server';
import { getChangeRequestsForEntries } from '@/lib/time-tracking/actions';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { entryIds } = body;

    if (!entryIds || !Array.isArray(entryIds)) {
      return NextResponse.json(
        { success: false, error: 'invalid_request' },
        { status: 400 }
      );
    }

    const result = await getChangeRequestsForEntries(entryIds);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in /api/change-requests-for-entries:', error);
    return NextResponse.json(
      { success: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}


