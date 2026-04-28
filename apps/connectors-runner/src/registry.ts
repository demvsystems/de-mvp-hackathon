import { type ConnectorSpec, slackConnector } from '@repo/connectors';

export const connectors: Record<string, ConnectorSpec> = {
  [slackConnector.name]: slackConnector as ConnectorSpec,
};

export const sourceNames = Object.keys(connectors);
