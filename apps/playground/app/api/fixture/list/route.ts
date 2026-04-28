import { NextResponse } from 'next/server';
import { listSavedFixturesQuerySchema } from '@/lib/fixture/generate-schemas';
import { listSavedFixtures } from '@/lib/fixture/saved-fixtures';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = listSavedFixturesQuerySchema.safeParse({
    source: searchParams.get('source') ?? undefined,
    includeContent: searchParams.get('includeContent') ?? undefined,
    includeValidation: searchParams.get('includeValidation') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid list query.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await listSavedFixtures({
      ...(parsed.data.source ? { source: parsed.data.source } : {}),
      includeContent: parsed.data.includeContent,
      includeValidation: parsed.data.includeValidation,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unexpected list error.',
      },
      { status: 400 },
    );
  }
}
