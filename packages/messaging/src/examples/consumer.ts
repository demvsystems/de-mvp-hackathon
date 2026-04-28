import { createSubscriber, RecordObserved } from '../index';

const sub = createSubscriber({ consumer: 'demo-worker' }).on(RecordObserved, (record, ctx) => {
  console.log(
    `[record.observed] seq=${ctx.seq} source=${ctx.envelope.source} id=${record.id} body=${record.body}`,
  );
});

process.once('SIGINT', () => void sub.stop().then(() => process.exit(0)));
process.once('SIGTERM', () => void sub.stop().then(() => process.exit(0)));

sub.start().catch((err) => {
  console.error(err);
  process.exit(1);
});
