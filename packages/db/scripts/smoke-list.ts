import { sql } from '../src/client';
import { listActiveTopics } from '../src/read/topics';

async function main(): Promise<void> {
  const r = await listActiveTopics({ recent_assessments_limit: 1 });
  console.log(
    JSON.stringify(
      {
        count: r.length,
        sample: r.map((x) => ({
          id: x.topic.id,
          assessments: x.recent_assessments.length,
          character: x.recent_assessments[0]?.character ?? null,
        })),
      },
      null,
      2,
    ),
  );
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
