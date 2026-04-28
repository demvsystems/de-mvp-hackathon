import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IngestionSource } from './types';

/**
 * Liest eine einzelne JSON-Datei als kompletten Snapshot ein und liefert sie
 * als einziges Item. Pilot-Form: die Mocks sind ein verschachtelter Snapshot
 * pro Source. Wenn später Streaming-Quellen kommen (Webhook, JSONL), kommt
 * dafür ein eigener Reader hinzu — der Mapper bleibt unverändert.
 */
export class JsonSnapshotSource<TItem> implements IngestionSource<TItem> {
  constructor(private readonly path: string) {}

  async *items(): AsyncIterable<TItem> {
    const raw = await readFile(this.path, 'utf8');
    yield JSON.parse(raw) as TItem;
  }

  /** Convenience: baut einen Reader mit Datei relativ zu einem Verzeichnis. */
  static at<TItem>(dir: string, filename: string): JsonSnapshotSource<TItem> {
    return new JsonSnapshotSource<TItem>(join(dir, filename));
  }
}
