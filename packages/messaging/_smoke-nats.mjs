import { connect } from '@nats-io/transport-node';

const nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
const enc = new TextEncoder();
const dec = new TextDecoder();

const subject = 'reviewer.activity.smoke-test';
const wildcard = 'reviewer.activity.>';

const sub = nc.subscribe(wildcard);

const consumer = (async () => {
  for await (const m of sub) {
    console.log('RECV', m.subject, dec.decode(m.data));
    return true;
  }
  return false;
})();

setTimeout(() => {
  nc.publish(subject, enc.encode(JSON.stringify({ hello: 'world', ts: Date.now() })));
}, 50);

const ok = await Promise.race([consumer, new Promise((r) => setTimeout(() => r(false), 1500))]);
console.log('result:', ok);
await sub.drain();
await nc.drain();
process.exit(ok ? 0 : 1);
