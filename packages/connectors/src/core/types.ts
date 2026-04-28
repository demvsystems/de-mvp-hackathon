/**
 * Edge classes the connector layer is allowed to emit. Mirrors the design's
 * edge type enum (Zettel 1 + 2). The pipeline owner pins this exhaustively
 * in @repo/events; we duplicate it here to keep connectors decoupled.
 */
export type EdgeType =
  | 'authored_by'
  | 'replies_to'
  | 'commented_on'
  | 'posted_in'
  | 'child_of'
  | 'references'
  | 'assigned_to'
  | 'belongs_to_sprint'
  | 'mentions'
  | 'discusses'
  | 'supersedes';

export type IsoDateTime = string;

export type RecordOutput = {
  id: string;
  kind: string;
  source: string;
  occurred_at: IsoDateTime;
  source_event_id: string | null;
  title: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

export type EdgeOutput = {
  from_id: string;
  to_id: string;
  type: EdgeType;
  source: string;
  confidence: number;
  weight: number;
  valid_from: IsoDateTime;
  valid_to: IsoDateTime | null;
};

/**
 * What a connector emits per ingested row. Pipeline owner wraps each entry
 * into an EventEnvelope. When a `record` is present, edges in the same
 * output are caused by it (causation_id linkage is the pipeline's job).
 */
export type ConnectorOutput = {
  records: RecordOutput[];
  edges: EdgeOutput[];
};

/**
 * Per-row metadata embedded in JSONL fixtures. Streaming-mode replayers honor
 * `emit_at_offset_seconds` for realistic time spacing.
 */
export type SyntheticMeta = {
  emit_at_offset_seconds: number;
};

export type WithMeta<T> = T & { _meta: SyntheticMeta };

/**
 * Source of source-rows. Pilot impl reads JSONL files; real impl will hit
 * the source API. Same iface, swap-in.
 */
export interface IngestionSource<TRow> {
  rows(): AsyncIterable<TRow>;
}

/**
 * Uniform descriptor each connector lib exports. The dispatcher app picks one
 * by `name`, loads rows from `files` (one JSONL per kind), and calls
 * `handleRow` per parsed row. New connector = one entry in the registry.
 */
export interface ConnectorSpec<TRow extends { kind: string } = { kind: string }> {
  name: string;
  files: Record<string, string>;
  handleRow: (row: TRow) => ConnectorOutput;
}
