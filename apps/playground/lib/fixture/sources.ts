export const FIXTURE_SOURCES = ['jira', 'slack', 'upvoty', 'intercom'] as const;

export type FixtureSource = (typeof FIXTURE_SOURCES)[number];

export interface FixtureSourceDef {
  source: FixtureSource;
  templateRelativePath: string;
}

export const FIXTURE_SOURCE_DEFS: Record<FixtureSource, FixtureSourceDef> = {
  jira: {
    source: 'jira',
    templateRelativePath: 'apps/playground/Dummyfiles/fixture-base-Template/jira.json',
  },
  slack: {
    source: 'slack',
    templateRelativePath: 'apps/playground/Dummyfiles/fixture-base-Template/slack.json',
  },
  upvoty: {
    source: 'upvoty',
    templateRelativePath: 'apps/playground/Dummyfiles/upvoty-polling-examples.json',
  },
  intercom: {
    source: 'intercom',
    templateRelativePath: 'apps/playground/Dummyfiles/intercom-webhook-examples.json',
  },
};
