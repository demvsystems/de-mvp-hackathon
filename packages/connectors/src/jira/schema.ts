import { z } from 'zod';

export const JiraProject = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  type: z.string(),
});
export type JiraProject = z.infer<typeof JiraProject>;

export const JiraBoard = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  projectKey: z.string(),
});
export type JiraBoard = z.infer<typeof JiraBoard>;

export const JiraSprint = z.object({
  id: z.number(),
  name: z.string(),
  state: z.string(),
  goal: z.string().optional(),
  projectKeys: z.array(z.string()),
  boardId: z.number(),
  startDate: z.string(),
  endDate: z.string(),
});
export type JiraSprint = z.infer<typeof JiraSprint>;

export const JiraComment = z.object({
  authorRole: z.string(),
  bodyText: z.string(),
});
export type JiraComment = z.infer<typeof JiraComment>;

export const JiraAttachment = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
});
export type JiraAttachment = z.infer<typeof JiraAttachment>;

/**
 * Ein Lifecycle-Update auf einer Issue. `previous` hält die Felder, die VOR
 * diesem Update auf der Issue standen — der Mapper kann daraus den Stand vor
 * jedem Update rekonstruieren. Updates sind chronologisch aufsteigend.
 */
export const JiraIssueUpdate = z.object({
  at: z.iso.datetime(),
  previous: z
    .object({
      status: z.string().optional(),
      priority: z.string().optional(),
      summary: z.string().optional(),
      descriptionText: z.string().optional(),
      labels: z.array(z.string()).optional(),
      components: z.array(z.string()).optional(),
    })
    .strict(),
});
export type JiraIssueUpdate = z.infer<typeof JiraIssueUpdate>;

export const JiraIssue = z.object({
  key: z.string(),
  projectKey: z.string(),
  sprintId: z.number().optional(),
  type: z.string(),
  status: z.string(),
  priority: z.string(),
  summary: z.string(),
  descriptionText: z.string(),
  labels: z.array(z.string()).default([]),
  components: z.array(z.string()).default([]),
  comments: z.array(JiraComment).default([]),
  attachments: z.array(JiraAttachment).default([]),
  updates: z.array(JiraIssueUpdate).optional(),
  deleted_at: z.iso.datetime().optional(),
});
export type JiraIssue = z.infer<typeof JiraIssue>;

/**
 * Jira-Snapshot wie ihn der Daten-Generator liefert: Projekte, Boards, aktive
 * Sprints, Issues mit eingebetteten Kommentaren und Attachments. Issue-Keys
 * (`SHOP-142`) dienen im Pilot als ID-Bestandteil — Z2 erlaubt das, solange
 * keine Project-Moves passieren.
 */
export const JiraSnapshot = z.object({
  source: z.object({
    jiraSite: z.string(),
    projectScope: z
      .object({
        mode: z.string(),
        projectKeys: z.array(z.string()),
      })
      .optional(),
  }),
  projects: z.array(JiraProject).default([]),
  boards: z.array(JiraBoard).default([]),
  activeSprints: z.array(JiraSprint).default([]),
  issues: z.array(JiraIssue).default([]),
});
export type JiraSnapshot = z.infer<typeof JiraSnapshot>;
