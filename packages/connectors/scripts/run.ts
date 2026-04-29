import { argv, env, exit } from 'node:process';
import { isAbsolute, resolve } from 'node:path';
import { closeConnection } from '@repo/messaging';
import { intercomConnector, jiraConnector, slackConnector, upvotyConnector } from '../src';
import type { ConnectorOutput, Emission, IngestionSource } from '../src/core';
import { SlackApiSource } from '../src/slack/api-source';
import type { SlackSnapshot } from '../src/slack/schema';

type SourceMode = 'snapshot' | 'api';

interface RunOptions {
  name: string;
  dataDir: string;
  publish: boolean;
  source: SourceMode;
  slackChannel: string | undefined;
  slackOldest: string | undefined;
}

async function main(): Promise<void> {
  const opts = parseArgs();

  // Klarer Mode-Banner auf stderr, damit es im Output nicht versteckt ist.
  const sourceLabel =
    opts.source === 'api' ? `api channel=${opts.slackChannel}` : `snapshot ${opts.dataDir}`;
  console.error(
    `[connectors:${opts.name}] ${opts.publish ? 'PUBLISH → NATS' : 'preview (stdout)'} | source: ${sourceLabel}`,
  );

  let total = 0;
  for await (const emission of streamEmissions(opts)) {
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

async function* streamEmissions(opts: RunOptions): AsyncIterable<Emission> {
  // Switch statt Registry: behält die typed ConnectorSpec<TItem>-Generics pro Branch.
  switch (opts.name) {
    case 'slack': {
      const reader: IngestionSource<SlackSnapshot> =
        opts.source === 'api' ? buildSlackApiSource(opts) : slackConnector.read(opts.dataDir);
      yield* iterEmissions(reader, slackConnector.map);
      return;
    }
    case 'jira':
      assertSnapshotMode(opts);
      yield* iterEmissions(jiraConnector.read(opts.dataDir), jiraConnector.map);
      return;
    case 'intercom':
      assertSnapshotMode(opts);
      yield* iterEmissions(intercomConnector.read(opts.dataDir), intercomConnector.map);
      return;
    case 'upvoty':
      assertSnapshotMode(opts);
      yield* iterEmissions(upvotyConnector.read(opts.dataDir), upvotyConnector.map);
      return;
    default:
      throw new Error(`Unbekannter Connector: ${opts.name}`);
  }
}

function assertSnapshotMode(opts: RunOptions): void {
  if (opts.source !== 'snapshot') {
    throw new Error(
      `Connector "${opts.name}" unterstützt aktuell nur --source=snapshot. Live-API ist nur für slack implementiert.`,
    );
  }
}

function buildSlackApiSource(opts: RunOptions): SlackApiSource {
  const token = env['SLACK_BOT_TOKEN'];
  if (!token || token.length === 0) {
    throw new Error(
      'SLACK_BOT_TOKEN ist nicht gesetzt. Trage das Bot-Token (xoxb-...) der Slack-App in die .env ein.',
    );
  }
  const channelId = opts.slackChannel ?? env['SLACK_CHANNEL_ID'];
  if (!channelId || channelId.length === 0) {
    throw new Error(
      'Slack-Channel-ID fehlt. Setze SLACK_CHANNEL_ID in .env oder übergib --channel=C12345.',
    );
  }
  return new SlackApiSource({
    token,
    channelId,
    ...(opts.slackOldest !== undefined ? { oldest: opts.slackOldest } : {}),
  });
}

async function* iterEmissions<T>(
  reader: IngestionSource<T>,
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
const DEFAULT_DATA_DIR = 'fixtures';

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
  --source=<mode>   snapshot (default) oder api. api zieht live aus der
                    Source-API statt einer JSON-Datei. Aktuell nur slack.
  --channel=<id>    Slack-Channel-ID (z. B. C12345). Nur bei --source=api.
                    Alternativ SLACK_CHANNEL_ID aus .env.
  --oldest=<ts>     Optional. Slack-Backfill-Cutoff als Unix-ts-string.
  --help, -h        Diese Hilfe anzeigen.

Modes:
  Default           Preview-Mode: Emissions auf stdout, kein Netzwerk-IO.
  --publish         Live-Publish an NATS-JetStream.

Beispiele:
  pnpm connectors:slack                                 # Preview, Snapshot
  pnpm connectors:slack -- --publish                    # echt publishen
  pnpm connectors:jira ./mein/anderer/pfad              # Override des data-dir
  pnpm connectors:slack -- --source=api --channel=C123  # live aus Slack
  pnpm connectors:slack -- --source=api --publish       # live + an NATS
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

  const sourceFlag = readFlagValue(flags, '--source');
  if (sourceFlag !== undefined && sourceFlag !== 'snapshot' && sourceFlag !== 'api') {
    throw new Error(`Ungültiger --source=${sourceFlag}. Erlaubt: snapshot, api.`);
  }
  const source: SourceMode = sourceFlag === 'api' ? 'api' : 'snapshot';

  return {
    name,
    dataDir,
    publish: flags.includes('--publish'),
    source,
    slackChannel: readFlagValue(flags, '--channel'),
    slackOldest: readFlagValue(flags, '--oldest'),
  };
}

function readFlagValue(flags: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const hit = flags.find((f) => f.startsWith(prefix));
  if (hit === undefined) return undefined;
  return hit.slice(prefix.length);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
