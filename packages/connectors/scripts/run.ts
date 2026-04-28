import { argv, exit } from 'node:process';
import { isAbsolute, resolve } from 'node:path';
import { closeConnection } from '@repo/messaging';
import { intercomConnector, jiraConnector, slackConnector, upvotyConnector } from '../src';
import type { ConnectorOutput, Emission } from '../src/core';

interface RunOptions {
  name: string;
  dataDir: string;
  publish: boolean;
}

async function main(): Promise<void> {
  const opts = parseArgs();

  // Klarer Mode-Banner auf stderr, damit es im Output nicht versteckt ist.
  console.error(
    `[connectors:${opts.name}] ${opts.publish ? 'PUBLISH → NATS' : 'preview (stdout)'} | data: ${opts.dataDir}`,
  );

  let total = 0;
  for await (const emission of streamEmissions(opts.name, opts.dataDir)) {
    total += 1;
    if (opts.publish) {
      const ack = await emission.publish();
      console.log(
        `pub seq=${ack.seq} dup=${ack.duplicate} ${emission.event_type} ${emission.subject_id}`,
      );
    } else {
      console.log(`${emission.event_type.padEnd(20)} ${emission.subject_id}`);
    }
  }

  console.log(`\n${total} emissions ${opts.publish ? 'published' : 'previewed'}`);

  if (opts.publish) {
    await closeConnection();
  }
}

async function* streamEmissions(name: string, dir: string): AsyncIterable<Emission> {
  // Switch statt Registry: behält die typed ConnectorSpec<TItem>-Generics pro Branch.
  switch (name) {
    case 'slack':
      yield* iterEmissions(slackConnector.read(dir), slackConnector.map);
      return;
    case 'jira':
      yield* iterEmissions(jiraConnector.read(dir), jiraConnector.map);
      return;
    case 'intercom':
      yield* iterEmissions(intercomConnector.read(dir), intercomConnector.map);
      return;
    case 'upvoty':
      yield* iterEmissions(upvotyConnector.read(dir), upvotyConnector.map);
      return;
    default:
      throw new Error(`Unbekannter Connector: ${name}`);
  }
}

async function* iterEmissions<T>(
  reader: { items(): AsyncIterable<T> },
  map: (item: T) => ConnectorOutput,
): AsyncIterable<Emission> {
  for await (const item of reader.items()) {
    const { emissions } = map(item);
    yield* emissions;
  }
}

// Default-Datapath (relativ zum Repo-Root): unsere Pilot-Snapshots im Playground.
// Wird gegen INIT_CWD aufgelöst, sodass `pnpm connectors:slack` von überall im
// Repo aus konsistent denselben Ordner trifft.
const DEFAULT_DATA_DIR = 'apps/playground/Dummyfiles';

const HELP = `Usage:
  pnpm connectors:<slack|jira|intercom|upvoty> [data-dir] [flags]

Arguments:
  data-dir          Optional. Verzeichnis mit den Snapshot-Dateien.
                    Default: ${DEFAULT_DATA_DIR} (relativ zum Repo-Root,
                    aufgelöst gegen INIT_CWD).

Flags:
  --publish         Events ans messaging-Bus (NATS) senden statt nur preview.
                    Voraussetzung: NATS läuft (docker-compose up -d nats) und
                    Stream "EVENTS" ist provisioniert (pnpm worker:materializer:provision).
  --help, -h        Diese Hilfe anzeigen.

Modes:
  Default           Preview-Mode: Emissions auf stdout, kein Netzwerk-IO.
  --publish         Live-Publish an NATS-JetStream.

Beispiele:
  pnpm connectors:slack                       # Preview
  pnpm connectors:slack -- --publish          # echt publishen (-- vor dem Flag!)
  pnpm connectors:jira ./mein/anderer/pfad    # Override des data-dir
`;

function parseArgs(): RunOptions {
  const argsAfterScript = argv.slice(2);

  if (argsAfterScript.includes('--help') || argsAfterScript.includes('-h')) {
    console.log(HELP);
    exit(0);
  }

  const [name, ...rest] = argsAfterScript;
  if (!name) {
    console.error(HELP);
    exit(1);
  }

  const positional = rest.filter((a) => !a.startsWith('--'));
  const flags = rest.filter((a) => a.startsWith('--'));
  const rawDir = positional[0] ?? DEFAULT_DATA_DIR;
  const baseDir = process.env['INIT_CWD'] ?? process.cwd();
  const dataDir = isAbsolute(rawDir) ? rawDir : resolve(baseDir, rawDir);
  return {
    name,
    dataDir,
    publish: flags.includes('--publish'),
  };
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
