import {
  intercomConnector,
  jiraConnector,
  slackConnector,
  upvotyConnector,
  type ConnectorSpec,
} from '@repo/connectors';

/**
 * Eintrag pro Source. Cast auf `ConnectorSpec<unknown>` ist nötig, weil
 * die map-Funktion contravariant in TItem ist — die Source-spezifischen
 * Schemas validieren intern via Zod.
 */
export const connectors: Record<string, ConnectorSpec<unknown>> = {
  [slackConnector.name]: slackConnector as ConnectorSpec<unknown>,
  [jiraConnector.name]: jiraConnector as ConnectorSpec<unknown>,
  [intercomConnector.name]: intercomConnector as ConnectorSpec<unknown>,
  [upvotyConnector.name]: upvotyConnector as ConnectorSpec<unknown>,
};

export const sourceNames = Object.keys(connectors);
