import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/fixture/template', () => {
  it('returns loaded template metadata for valid source', async () => {
    const response = await GET(
      new Request('http://localhost:3001/api/fixture/template?source=intercom'),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      status: string;
      source: string;
      metadata: { topLevelFields: string[] };
    };
    expect(payload.status).toBe('loaded');
    expect(payload.source).toBe('intercom');
    expect(payload.metadata.topLevelFields.length).toBeGreaterThan(0);
  });

  it('rejects invalid source', async () => {
    const response = await GET(
      new Request('http://localhost:3001/api/fixture/template?source=unknown'),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { status: string; message: string };
    expect(payload.status).toBe('error');
    expect(payload.message).toContain('Invalid source');
  });
});
