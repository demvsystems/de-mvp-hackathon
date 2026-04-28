import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { watch } from 'node:fs';
import type { ConnectorSpec } from '@repo/connectors';
import { connectors, sourceNames } from './registry';

/**
 * Läuft eine Source einmal durch ihren Reader, ruft `map()` pro Item auf und
 * gibt jede Emission als JSON-Zeile auf stdout aus. Im Watch-Modus wird der
 * Vorgang bei Änderung im Daten-Verzeichnis wiederholt.
 */
async function replay(spec: ConnectorSpec<unknown>, dir: string): Promise<void> {
  for await (const item of spec.read(dir).items()) {
    const { emissions } = spec.map(item);
    for (const e of emissions) {
      process.stdout.write(
        JSON.stringify({
          event_type: e.event_type,
          subject_id: e.subject_id,
          source: e.source,
          payload: e.payload,
        }) + '\n',
      );
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      data: { type: 'string' },
      watch: { type: 'boolean', default: false },
    },
  });

  const cwd = process.env['INIT_CWD'] ?? process.cwd();
  const baseDir = values.data
    ? isAbsolute(values.data)
      ? values.data
      : resolve(cwd, values.data)
    : resolve(cwd, 'apps/playground/Dummyfiles');

  const selected = values.source ? [values.source] : sourceNames;
  for (const name of selected) {
    if (!connectors[name]) {
      console.error(`unknown source: ${name}. available: ${sourceNames.join(', ')}`);
      process.exit(2);
    }
  }

  for (const name of selected) {
    const spec = connectors[name]!;
    console.error(`[runner] replay ${name} from ${baseDir}`);
    await replay(spec, baseDir);
  }

  if (!values.watch) return;

  for (const name of selected) {
    const spec = connectors[name]!;
    let pending: NodeJS.Timeout | null = null;
    watch(baseDir, () => {
      if (pending) clearTimeout(pending);
      // Editoren feuern beim Speichern mehrere Events; wir entprellen.
      pending = setTimeout(() => {
        pending = null;
        console.error(`[runner] ${name} fixtures changed, replaying`);
        replay(spec, baseDir).catch((err) => {
          console.error(`[runner] ${name} replay failed:`, err);
        });
      }, 100);
    });
  }

  console.error(`[runner] watching ${selected.join(', ')} (Ctrl+C to exit)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
