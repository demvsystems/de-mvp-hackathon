import { connect, type NatsConnection } from '@nats-io/transport-node';

let connection: NatsConnection | null = null;
let connecting: Promise<NatsConnection> | null = null;

export async function getConnection(): Promise<NatsConnection> {
  if (connection && !connection.isClosed()) return connection;
  if (connecting) return connecting;

  connecting = connect({
    servers: process.env.NATS_URL ?? 'nats://localhost:4222',
    name: process.env.NATS_CLIENT_NAME ?? 'messaging',
    reconnect: true,
    maxReconnectAttempts: -1,
  })
    .then((nc) => {
      connection = nc;
      return nc;
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
}

export async function closeConnection(): Promise<void> {
  const nc = connection;
  connection = null;
  if (nc && !nc.isClosed()) await nc.drain();
}
