import { NextResponse } from 'next/server';
import { saveFixtureRequestSchema } from '@/lib/fixture/generate-schemas';
import { saveFixtures } from '@/lib/fixture/save-fixtures';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid JSON body.',
      },
      { status: 400 },
    );
  }

  const parsed = saveFixtureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid save request.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await saveFixtures(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        {
          status: 'error',
          message: error.message,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        status: 'error',
        message: 'Unexpected save error.',
      },
      { status: 500 },
    );
  }
}
