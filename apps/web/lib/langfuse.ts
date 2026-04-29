import 'server-only';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getLangfuseTraceUrl(traceId: string): string | null {
  const rawBase = process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'];
  if (!rawBase) return null;

  const base = trimTrailingSlash(rawBase);
  const projectId = process.env['LANGFUSE_PROJECT_ID'];

  const projectMatch = base.match(/\/project\/([^/]+)$/);
  if (projectMatch) return `${base}/traces/${traceId}`;

  if (projectId) return `${base}/project/${projectId}/traces/${traceId}`;

  // Langfuse Cloud trace pages are project-scoped. Without a project id we
  // would render a broken `/traces/<id>` link, so hide it instead.
  if (base === 'https://cloud.langfuse.com') return null;

  return `${base}/traces/${traceId}`;
}
