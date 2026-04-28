import { sql } from '../src/client';

interface DemoTopic {
  id: string;
  label: string;
  description: string | null;
  character: 'attention' | 'opportunity' | 'noteworthy' | 'calm';
  score: number;
  summary: string;
  signals: string[];
  artifacts: string[];
  member_count: number;
  source_count: number;
  unique_authors_7d: number;
  velocity_24h: number;
  velocity_7d_avg: number;
  trend: 'growing' | 'stable' | 'declining' | 'dormant';
  stagnation: 'none' | 'low' | 'medium' | 'high';
  stagnation_count: number;
  attach_record_ids: string[];
}

const now = new Date('2026-04-28T12:00:00Z').toISOString();

const topics: DemoTopic[] = [
  {
    id: 'topic:demo:bipro-430',
    label: 'BiPro 430.4 / Concordia-Bestandsverlust',
    description: 'Makler-Frust um Bestandsübertragung an externe Pools (BiPro Norm 430.4)',
    character: 'attention',
    score: 0.84,
    summary:
      'verstärkt frustriert mit Eskalations-Trend; mehrere Makler thematisieren das Bestandsverlust-Problem direkt oder via DEMV-4127',
    signals: [
      'drei neue Slack-Threads in 24h, alle mit Bestandsverlust-Bezug',
      'Jira-Ticket DEMV-4127 hat 5 Cross-Source-Mentions, ist aber unzugewiesen und Low-Priority',
      'Stagnations-Signal: zwei Threads ohne Antwort seit 4 Tagen',
      'WON_DEAL_005 erwähnt Topic explizit als Risiko',
    ],
    artifacts: ['slack:msg:T01ABC/C02DEF/1714028591.012345', 'jira:issue:10042'],
    member_count: 12,
    source_count: 4,
    unique_authors_7d: 7,
    velocity_24h: 3,
    velocity_7d_avg: 1.4,
    trend: 'growing',
    stagnation: 'low',
    stagnation_count: 2,
    attach_record_ids: [
      'slack:msg:T01ABC/C02DEF/1714028000.001234',
      'slack:msg:T01ABC/C02DEF/1714028591.012345',
      'slack:msg:T01ABC/C02DEF/1714029200.054321',
    ],
  },
  {
    id: 'topic:demo:gpt-callouts',
    label: 'GPT-Callouts in Beratungs-UI begeistern Makler',
    description: null,
    character: 'opportunity',
    score: 0.71,
    summary:
      'durchgehend positive Resonanz auf das neue GPT-Callout im Beratungs-Modal; mehrere Makler fragen nach Roll-out auf weitere Sparten',
    signals: [
      'sechs Slack-Posts mit explizitem "endlich"/"super" in 7 Tagen',
      'zwei Intercom-Threads mit Feature-Wunsch zur Übertragung auf KFZ',
      'kein einziger Beschwerde-Thread im Zeitraum',
    ],
    artifacts: [],
    member_count: 17,
    source_count: 3,
    unique_authors_7d: 11,
    velocity_24h: 4,
    velocity_7d_avg: 2.3,
    trend: 'growing',
    stagnation: 'none',
    stagnation_count: 0,
    attach_record_ids: [],
  },
  {
    id: 'topic:demo:onboarding-stagnation',
    label: 'Onboarding-Strecke stagniert seit März',
    description: null,
    character: 'noteworthy',
    score: 0.42,
    summary:
      'Eskalation flach, aber Aktivität konstant niedrig — Risiko für stille Frustration in der Onboarding-Strecke',
    signals: [
      'Velocity unter 7d-Mittel',
      'Keine neuen Beschwerden, aber auch keine Lösungsbeiträge',
    ],
    artifacts: [],
    member_count: 6,
    source_count: 2,
    unique_authors_7d: 3,
    velocity_24h: 0,
    velocity_7d_avg: 0.4,
    trend: 'stable',
    stagnation: 'medium',
    stagnation_count: 4,
    attach_record_ids: [],
  },
];

async function main(): Promise<void> {
  for (const t of topics) {
    await sql`
      INSERT INTO topics (
        id, status, label, description, discovered_at, discovered_by,
        member_count, source_count, unique_authors_7d,
        velocity_24h, velocity_7d_avg, activity_trend,
        stagnation_severity, stagnation_signal_count,
        last_activity_at, payload
      ) VALUES (
        ${t.id}, 'active', ${t.label}, ${t.description}, ${now}, 'demo:seed',
        ${t.member_count}, ${t.source_count}, ${t.unique_authors_7d},
        ${t.velocity_24h}, ${t.velocity_7d_avg}, ${t.trend},
        ${t.stagnation}, ${t.stagnation_count},
        ${now}, '{}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `;

    const reasoning = {
      summary: t.summary,
      key_signals: t.signals,
      key_artifacts: t.artifacts,
    };

    await sql`
      INSERT INTO topic_assessments (
        topic_id, assessor, assessed_at,
        character, escalation_score, reasoning, triggered_by
      ) VALUES (
        ${t.id}, 'demo:seed', ${now},
        ${t.character}, ${t.score},
        ${JSON.stringify(reasoning)}::jsonb,
        'demo:seed'
      )
      ON CONFLICT (topic_id, assessor, assessed_at) DO NOTHING
    `;

    for (const recordId of t.attach_record_ids) {
      await sql`
        INSERT INTO edges (
          from_id, to_id, type, source, confidence, weight,
          valid_from, valid_to, observed_at
        ) VALUES (
          ${recordId}, ${t.id}, 'discusses', 'demo:seed:v1', 0.9, 1,
          ${now}, NULL, ${now}
        )
        ON CONFLICT (from_id, to_id, type, source) DO NOTHING
      `;
    }
  }

  const counts = await sql<{ topics: number; assessments: number; demo_edges: number }[]>`SELECT
      (SELECT count(*)::int FROM topics WHERE discovered_by = 'demo:seed') AS topics,
      (SELECT count(*)::int FROM topic_assessments WHERE assessor = 'demo:seed') AS assessments,
      (SELECT count(*)::int FROM edges WHERE source = 'demo:seed:v1') AS demo_edges`;
  console.log('seeded:', counts[0]);

  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
