import { NextResponse } from 'next/server';
import { deleteSavedFixtureRequestSchema } from '@/lib/fixture/generate-schemas';
import { deleteSavedFixture, SavedFixtureError } from '@/lib/fixture/saved-fixtures';

export async function DELETE(request: Request) {
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

  const parsed = deleteSavedFixtureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid delete request.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await deleteSavedFixture(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SavedFixtureError) {
      return NextResponse.json(
        {
          status: 'error',
          code: error.code,
          message: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        status: 'error',
        message: 'Unexpected delete error.',
      },
      { status: 500 },
    );
  }
}
