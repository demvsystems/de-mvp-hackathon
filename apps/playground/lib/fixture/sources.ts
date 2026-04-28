export const FIXTURE_SOURCES = ['jira', 'slack', 'upvoty', 'intercom'] as const;

export type FixtureSource = (typeof FIXTURE_SOURCES)[number];

export interface FixtureSourceDef {
  source: FixtureSource;
  templateRelativePath: string;
}

export const FIXTURE_SOURCE_DEFS: Record<FixtureSource, FixtureSourceDef> = {
  jira: {
    source: 'jira',
    templateRelativePath: 'fixtures/jira.json',
  },
  slack: {
    source: 'slack',
    templateRelativePath: 'fixtures/slack.json',
  },
  upvoty: {
    source: 'upvoty',
    templateRelativePath: 'fixtures/upvoty.json',
  },
  intercom: {
    source: 'intercom',
    templateRelativePath: 'fixtures/intercom.json',
  },
};
