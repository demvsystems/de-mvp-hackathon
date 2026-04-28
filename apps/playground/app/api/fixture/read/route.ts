import { NextResponse } from 'next/server';
import { readSavedFixtureQuerySchema } from '@/lib/fixture/generate-schemas';
import { readSavedFixture, SavedFixtureError } from '@/lib/fixture/saved-fixtures';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = readSavedFixtureQuerySchema.safeParse({
    source: searchParams.get('source') ?? undefined,
    filename: searchParams.get('filename') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid read query.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await readSavedFixture(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SavedFixtureError) {
      return NextResponse.json(
        {
          status: 'error',
          code: error.code,
          message: error.message,
          ...(error.details ? error.details : {}),
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        status: 'error',
        message: 'Unexpected read error.',
      },
      { status: 500 },
    );
  }
}
