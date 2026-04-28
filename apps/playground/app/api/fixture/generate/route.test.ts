import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/fixture/generate', () => {
  it('returns requested count for valid payload', async () => {
    const response = await POST(
      new Request('http://localhost:3001/api/fixture/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'jira',
          topic: 'CSV Import',
          product: 'internal-tool',
          category: 'bug',
          language: 'de',
          count: 3,
          detailLevel: 'medium',
          severity: 'medium',
          sentiment: 'frustrated',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: Array<{ filename: string }>;
      warnings: string[];
      generationMode: 'ai' | 'fallback';
      validation: Array<{ filename: string; status: 'ok' | 'warning' | 'error' }>;
    };
    expect(payload.items).toHaveLength(3);
    expect(payload.items[0]?.filename.endsWith('.json')).toBe(true);
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.generationMode).toBe('fallback');
    expect(payload.validation).toHaveLength(3);
    expect(payload.validation[0]?.filename).toBe(payload.items[0]?.filename);
  });

  it('rejects invalid source', async () => {
    const response = await POST(
      new Request('http://localhost:3001/api/fixture/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'unknown',
          topic: 'x',
          product: 'y',
          category: 'z',
          language: 'de',
          count: 1,
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects invalid count', async () => {
    const response = await POST(
      new Request('http://localhost:3001/api/fixture/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'slack',
          topic: 'x',
          product: 'y',
          category: 'z',
          language: 'de',
          count: 0,
        }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
