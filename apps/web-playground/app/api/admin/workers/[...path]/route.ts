import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CONTROL_BASE = `http://127.0.0.1:${process.env.BACKEND_CONTROL_PORT ?? '3100'}`;

async function proxy(req: Request, path: string[]): Promise<NextResponse> {
  const url = `${CONTROL_BASE}/${path.join('/')}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `backend control server unreachable at ${CONTROL_BASE}: ${message}` },
      { status: 502 },
    );
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  return proxy(req, path);
}
