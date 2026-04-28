import { parseArgs } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { watch } from 'node:fs';
import { JsonlSource, type ConnectorSpec } from '@repo/connectors';
import {
  closeConnection,
  EdgeObserved,
  provisionStream,
  publish,
  RecordObserved,
} from '@repo/messaging';
import { connectors, sourceNames } from './registry';

function edgeSubjectId(type: string, fromId: string, toId: string): string {
  return `edge:${type}:${fromId}->${toId}`;
}

async function replay(spec: ConnectorSpec, sourceDir: string): Promise<void> {
  const tagged: Array<{ row: { kind: string }; offset: number }> = [];
  for (const [kind, file] of Object.entries(spec.files)) {
    const path = join(sourceDir, file);
    const src = new JsonlSource<Record<string, unknown>>(path);
    for await (const raw of src.rows()) {
      const meta = raw['_meta'] as { emit_at_offset_seconds: number } | undefined;
      const offset = meta?.emit_at_offset_seconds ?? 0;
      tagged.push({ row: { ...(raw as object), kind } as { kind: string }, offset });
    }
  }
  tagged.sort((a, b) => a.offset - b.offset);

  for (const { row } of tagged) {
    const out = spec.handleRow(row);

    for (const r of out.records) {
      await publish(RecordObserved, {
        source: r.source,
        occurred_at: r.occurred_at,
        subject_id: r.id,
        correlation_id: r.id,
        ...(r.source_event_id !== null ? { source_event_id: r.source_event_id } : {}),
        payload: {
          id: r.id,
          type: r.kind,
          source: r.source,
          title: r.title,
          body: r.body,
          payload: r.payload,
          created_at: r.created_at,
          updated_at: r.updated_at,
        },
      });
    }

    for (const e of out.edges) {
      await publish(EdgeObserved, {
        source: spec.name,
        occurred_at: e.valid_from,
        subject_id: edgeSubjectId(e.type, e.from_id, e.to_id),
        correlation_id: out.records[0]?.id ?? e.from_id,
        payload: {
          from_id: e.from_id,
          to_id: e.to_id,
          type: e.type,
          source: e.source,
          confidence: e.confidence,
          weight: e.weight,
          valid_from: e.valid_from,
          valid_to: e.valid_to,
        },
      });
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      data: { type: 'string' },
    },
  });
  const cwd = process.env['INIT_CWD'] ?? process.cwd();
  const baseDir = values.data
    ? isAbsolute(values.data)
      ? values.data
      : resolve(cwd, values.data)
    : resolve(cwd, 'synthetic-data');

  const selected = values.source ? [values.source] : sourceNames;
  for (const name of selected) {
    if (!connectors[name]) {
      console.error(`unknown source: ${name}. available: ${sourceNames.join(', ')}`);
      process.exit(2);
    }
  }

  await provisionStream();

  for (const name of selected) {
    const spec = connectors[name]!;
    const sourceDir = join(baseDir, name);
    console.error(`[runner] replay ${name} from ${sourceDir}`);
    await replay(spec, sourceDir);
  }

  for (const name of selected) {
    const spec = connectors[name]!;
    const sourceDir = join(baseDir, name);
    let pending: NodeJS.Timeout | null = null;
    watch(sourceDir, () => {
      if (pending) clearTimeout(pending);
      // Editors fire multiple events per save; coalesce. Replays are idempotent
      // via deterministic event_id + JetStream Nats-Msg-Id dedup.
      pending = setTimeout(() => {
        pending = null;
        console.error(`[runner] ${name} fixtures changed, replaying`);
        replay(spec, sourceDir).catch((err) => {
          console.error(`[runner] ${name} replay failed:`, err);
        });
      }, 100);
    });
  }

  console.error(`[runner] watching ${selected.join(', ')} (Ctrl+C to exit)`);

  const shutdown = (signal: string): void => {
    console.error(`[runner] received ${signal}, draining`);
    void closeConnection().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
