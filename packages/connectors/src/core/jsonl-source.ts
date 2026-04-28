import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { IngestionSource } from './types';

/**
 * Reads one JSONL file. Skips blank lines. Throws on malformed JSON so the
 * connector fails loudly rather than silently swallowing fixture bugs.
 */
export class JsonlSource<TRow> implements IngestionSource<TRow> {
  constructor(private readonly path: string) {}

  async *rows(): AsyncIterable<TRow> {
    const stream = createReadStream(this.path, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNo = 0;
    for await (const raw of lines) {
      lineNo += 1;
      const line = raw.trim();
      if (line.length === 0) continue;
      try {
        yield JSON.parse(line) as TRow;
      } catch (err) {
        throw new Error(
          `JsonlSource: bad JSON at ${this.path}:${lineNo}: ${(err as Error).message}`,
        );
      }
    }
  }
}
