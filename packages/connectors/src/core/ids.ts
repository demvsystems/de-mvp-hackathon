import type { EdgeType } from '@repo/messaging';

/**
 * Baut eine deterministische Record-ID nach Schema `<source>:<kind>:<parts>`.
 * `kind` ist der ID-Token (kurz, z.B. 'msg'), nicht der Inner-Payload-`type`.
 */
export function makeRecordId(source: string, kind: string, ...parts: string[]): string {
  return `${source}:${kind}:${parts.join('/')}`;
}

/**
 * Baut eine deterministische Edge-Subject-ID. Wird beim Publishen als
 * `subject_id` gesetzt; das Edge-Tupel `(from_id, to_id, type, source)` ist
 * der UNIQUE-Schlüssel im Materializer.
 */
export function makeEdgeId(type: EdgeType, fromId: string, toId: string): string {
  return `edge:${type}:${fromId}->${toId}`;
}

/** Versionierter Source-Tag für Edges, z.B. 'slack:v1'. Siehe Zettel 1. */
export function edgeSource(source: string, version = 'v1'): string {
  return `${source}:${version}`;
}
