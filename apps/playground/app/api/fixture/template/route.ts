import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadTemplateForSource, TemplateLoadError } from '@/lib/fixture/template-loader';
import { FIXTURE_SOURCES } from '@/lib/fixture/sources';

const SourceParamSchema = z.enum(FIXTURE_SOURCES);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get('source');
  const sourceResult = SourceParamSchema.safeParse(sourceParam);

  if (!sourceResult.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid source. Use jira, slack, upvoty, or intercom.',
      },
      { status: 400 },
    );
  }

  try {
    const loaded = await loadTemplateForSource(sourceResult.data);
    return NextResponse.json(loaded, { status: 200 });
  } catch (error) {
    if (error instanceof TemplateLoadError) {
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
        message: 'Unexpected template loading error.',
      },
      { status: 500 },
    );
  }
}
