# AGENTS.md

Telegraph style. Root rules.

## Start

- New `AGENTS.md`: add a sibling `CLAUDE.md` symlink (`ln -s AGENTS.md CLAUDE.md`).
- Missing deps: `pnpm install`, retry once, then report first actionable error.
- Replies: repo-relative refs only (e.g. `lib/utils.ts:1`). No absolute paths, no `~/`.

## Map

- `app/` — Next pages + route handlers.
- `components/ui/` — shadcn primitives.
- `lib/` — shared utilities.
- `db/` — Drizzle schema + client.

## Commands

- `pnpm dev` / `build` / `lint` / `typecheck` / `test`.
- `pnpm format` / `format:check`.
- `pnpm db:push` / `db:generate` / `db:migrate` / `db:studio`.
- `docker-compose up -d` — local Postgres.

## Gates

- Pre-commit (husky + lint-staged): prettier + eslint on staged files. Don't bypass with `--no-verify`.
- Pre-push (husky): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- CI required: `lint`, `typecheck`, `build`.

## Code

- TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. No `any`. No `@ts-nocheck`.
- Comments only when WHY is non-obvious.

## Tests

- Vitest, colocated `*.test.ts`.

## Git

- Small commits. Conventional-ish messages. Don't bypass hooks.
- Branch off `main`. PR before merge. CI green.
