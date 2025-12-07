import { NextResponse } from 'next/server';
import { getTimeEntries } from '@/lib/time-tracking/actions';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await getTimeEntries(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in /api/time-entries:', error);
    return NextResponse.json(
      { success: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}
