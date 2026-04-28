/**
 * Eine Pattern-Definition kapselt Regex + Metadaten + Resolver für eine
 * Klasse von Cross-Source-Verweisen. Patterns leben pro Datei unter
 * `patterns/<name>.ts` und werden über `patterns/index.ts` registriert.
 *
 * Source-spezifische Annahmen sind in der Pattern-Definition isoliert —
 * der Matcher behandelt alle Patterns gleich.
 */
export interface MentionPattern {
  /** Eindeutiger Name für Provenance und Debug-Output. Wandert ins
   *  Edge-Evidence (`pattern_name`). */
  readonly name: string;

  /** Regex zum Scannen des Bodies. Muss `g`-Flag haben, damit
   *  `String.prototype.matchAll()` mehrere Treffer liefert. */
  readonly regex: RegExp;

  /** Pilot-Konfidenz aus Z7. URL-Patterns sind eindeutig (0.99),
   *  freie Keys etwas niedriger (0.93–0.95). */
  readonly confidence: number;

  /** Baut aus dem Match-Array die kanonische Target-ID. Async, weil
   *  manche Patterns einen DB-Lookup brauchen (z.B. Jira-Key auf
   *  numerische Issue-ID). Liefert `null`, wenn das Target noch nicht
   *  ingestiert ist — der Worker reicht es dann an pending-Resolution. */
  readonly buildTargetId: (match: RegExpMatchArray) => Promise<string | null> | string | null;

  /** Optional: Source-Filter. Ein Pattern wird nur auf Records dieser
   *  Sources angewandt. Default: alle Sources. */
  readonly applyToSources?: readonly string[];
}

/** Ein einzelner Match aus einem Pattern, vor Resolver-Auflösung. */
export interface MentionMatch {
  readonly patternName: string;
  readonly confidence: number;
  readonly matchText: string;
  readonly matchStart: number;
  readonly matchEnd: number;
  readonly matchGroups: readonly string[];
}
