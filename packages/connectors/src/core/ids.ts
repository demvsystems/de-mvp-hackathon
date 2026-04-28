import type { EdgeType } from './types';

export function makeRecordId(source: string, kind: string, ...parts: string[]): string {
  return `${source}:${kind}:${parts.join('/')}`;
}

export function makeEdgeId(type: EdgeType, fromId: string, toId: string): string {
  return `edge:${type}:${fromId}->${toId}`;
}

/** Versioned source-tag for edges, e.g. 'slack:v1'. Per design Zettel 2. */
export function edgeSource(source: string, version = 'v1'): string {
  return `${source}:${version}`;
}
