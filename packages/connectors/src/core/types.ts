import {
  publish as basePublish,
  type EventDefinition,
  type PublishAck,
  type PublishInput,
} from '@repo/messaging';

export type IsoDateTime = string;

/**
 * Eine Emission kapselt eine fertig konfigurierte Publish-Anweisung an das
 * messaging-Package. Der Mapper erzeugt sie via `emit()`, der Runner ruft
 * `publish()` auf. Die Generic-Information (Payload-Typ) wird in der Closure
 * gehalten, sodass eine heterogene Liste von Emissions ohne Cast-Akrobatik
 * funktioniert.
 */
export interface Emission {
  readonly event_type: string;
  readonly subject_id: string;
  readonly source: string;
  readonly payload: unknown;
  /**
   * Verweis auf das Event, das diese Emission ausgelöst hat. Bei strukturellen
   * Edges aus dem Connector ist das die `event_id` des dazugehörigen
   * Record-Events — damit ist die Provenance vom Edge zurück zum Auslöser
   * traversierbar (siehe 02_connectors.md, "Pro Record-Event: Causation-Kette").
   */
  readonly causation_id: string | null;
  /**
   * Per-Source-Korrelation: alle Events einer Konversation/Cascade tragen
   * denselben Schlüssel. Slack: Top-Level-Message, Intercom: Conversation,
   * Jira: Sprint, Upvoty: Post. Macht Trace und Debug nachvollziehbar.
   */
  readonly correlation_id: string | null;
  publish(): Promise<PublishAck>;
}

/**
 * Typsicherer Konstruktor: Generic-Inferenz bindet `EventDefinition<T>` und
 * `PublishInput<T>` aneinander. Aufrufer können die falsche Payload-Form für
 * ein gegebenes Event nicht zuweisen — das fängt der Compiler ab, bevor
 * Runtime-Validation greift.
 */
export function emit<T>(event: EventDefinition<T>, input: PublishInput<T>): Emission {
  return {
    event_type: event.event_type,
    subject_id: input.subject_id,
    source: input.source,
    payload: input.payload,
    causation_id: input.causation_id ?? null,
    correlation_id: input.correlation_id ?? null,
    publish: () => basePublish(event, input),
  };
}

/**
 * Was ein Mapper pro Source-Item zurückgibt: eine Liste von Emissions, die
 * der Runner via `e.publish()` ans Bus schickt.
 */
export interface ConnectorOutput {
  emissions: Emission[];
}

/**
 * Reader-Schicht: liefert Source-Items aus einer konkreten Quelle. Heute lesen
 * die Implementierungen Snapshot-JSON-Files; später könnten Webhook-Listener
 * oder API-Poller die gleiche Schnittstelle erfüllen.
 */
export interface IngestionSource<TItem> {
  items(): AsyncIterable<TItem>;
}

/**
 * Connector-Registry-Eintrag. Ein Runner wählt einen Connector über `name`,
 * fragt einen Reader für ein Daten-Verzeichnis ab und mappt jedes Item via
 * `map()` auf Emissions.
 */
export interface ConnectorSpec<TItem = unknown> {
  name: string;
  read(dir: string): IngestionSource<TItem>;
  map(item: TItem): ConnectorOutput;
}
