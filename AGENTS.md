# AGENTS.md

Telegraph style. Root rules.

## Start

- New `AGENTS.md`: add a sibling `CLAUDE.md` symlink (`ln -s AGENTS.md CLAUDE.md`).
- Missing deps: `pnpm install`, retry once, then report first actionable error.
- Replies: repo-relative refs only (e.g. `lib/utils.ts:1`). No absolute paths, no `~/`.

## Map

pnpm workspace. Packages:

- `apps/web/` — Next app.
  - `app/` — pages + route handlers.
  - `components/ui/` — shadcn primitives.
  - `lib/` — web-local utilities.
- `apps/playground/` — Next app on port 3001 for vibe-coder data-gen UIs.
- `packages/db/` — Drizzle schema + client (`@repo/db`, consumed via workspace).

Workspace conventions:

- Hoist `@types/*` and `*eslint*` to root via `.npmrc` so transitive React/JSX types resolve correctly inside dep packages.
- Cross-package import: `import { db } from '@repo/db'`.

## Commands

Run from repo root unless noted.

- `pnpm dev` / `pnpm start` — both apps in parallel (web :3000, playground :3001).
- `pnpm build` / `lint` / `typecheck` / `test` — fan out via `pnpm -r`.
- `pnpm format` / `format:check`.
- `pnpm db:push` / `db:generate` / `db:migrate` / `db:studio` — runs in `packages/db`.
- `docker-compose up -d` — local Postgres.

## Gates

- Pre-commit (husky + lint-staged): prettier on staged files. Don't bypass with `--no-verify`.
- Pre-push (husky): `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (all fan out to every workspace package).
- CI required: `lint`, `typecheck`, `build`.

## Code

- TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. No `any`. No `@ts-nocheck`.
- Comments only when WHY is non-obvious.

## Tests

- Vitest, colocated `*.test.ts`.

## Git

- Small commits. Conventional-ish messages. Don't bypass hooks.
- Work on `main`. Push direct after pre-push gate is green.
