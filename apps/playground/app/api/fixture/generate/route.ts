import { NextResponse } from 'next/server';
import { generatePreview } from '@/lib/fixture/generate-preview';
import { GeneratePreviewRequestSchema } from '@/lib/fixture/generate-schemas';
import { TemplateLoadError } from '@/lib/fixture/template-loader';

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

  const parsed = GeneratePreviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Invalid generate request.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await generatePreview(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TemplateLoadError) {
      return NextResponse.json(
        {
          status: 'error',
          message: error.message,
          code: error.code,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        status: 'error',
        message: 'Unexpected generation error.',
      },
      { status: 500 },
    );
  }
}
