import { closeConnection, publish, RecordObserved } from '../index';

async function main(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const id = `slack:msg:demo/C0DEMO/${Date.now()}.${i}`;
    const now = new Date().toISOString();
    const ack = await publish(RecordObserved, {
      source: 'slack',
      occurred_at: now,
      subject_id: id,
      payload: {
        id,
        type: 'message',
        source: 'slack',
        title: null,
        body: `demo message ${i}`,
        payload: { channel_id: 'C0DEMO' },
        created_at: now,
        updated_at: now,
      },
    });
    console.log(`published seq=${ack.seq} event_id=${ack.event_id} duplicate=${ack.duplicate}`);
  }
  await closeConnection();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
