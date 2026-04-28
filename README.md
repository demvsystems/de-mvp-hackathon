# Starter

Next 16 + React 19 + shadcn + Tailwind 4 + Drizzle + Postgres starter.

## Stack

- Next 16 + React 19
- Tailwind 4 + shadcn (`base-nova` style → `@base-ui/react`)
- Drizzle + Postgres (pgvector image; extension only loaded if you `CREATE EXTENSION vector`)
- Vitest + GitHub Actions
- pnpm + Node 24 LTS
- ESLint 9 (flat) + Prettier
- husky + lint-staged

## Quickstart

### Prerequisites

- **Node 24 LTS** — via a version manager (recommended) or Homebrew:
  - `nvm`: `nvm install 24 && nvm use 24`
  - `fnm`: `fnm install 24 && fnm use 24`
  - `mise`: `mise use -g node@24`
  - Homebrew: `brew install node@24`
- **pnpm 10+** — via Corepack (ships with Node, recommended):
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```
  Alternatives: `brew install pnpm` or the standalone script at <https://pnpm.io/installation>.
- **Docker** — Docker Desktop or [OrbStack](https://orbstack.dev) on macOS; Docker Engine on Linux (`curl -fsSL https://get.docker.com | sh`).

Verify: `node -v` (v24.x), `pnpm -v` (10.x), `docker -v`.

### Setup

```bash
# Install deps, create .env, start Docker services, and push the DB schema
pnpm init:dev

# Run dev server
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

### General

| Script                                           | Purpose                               |
| ------------------------------------------------ | ------------------------------------- |
| `pnpm init:dev`                                  | local setup: deps, env, Docker, DB    |
| `pnpm dev`                                       | Next dev server (Turbopack)           |
| `pnpm build`                                     | production build                      |
| `pnpm lint`                                      | ESLint                                |
| `pnpm typecheck`                                 | `tsc --noEmit`                        |
| `pnpm format` / `pnpm format:check`              | Prettier                              |
| `pnpm test` / `pnpm test:watch` / `pnpm test:ui` | Vitest                                |
| `pnpm db:push`                                   | push schema to DB (no migration file) |
| `pnpm db:generate`                               | generate migration from schema diff   |
| `pnpm db:migrate`                                | apply migrations                      |
| `pnpm db:studio`                                 | Drizzle Studio (DB GUI)               |

### Event-System (Connectors + Materializer)

Lokale Infra hochfahren:

```bash
docker-compose up -d                  # Postgres + NATS JetStream
pnpm worker:materializer:provision    # Stream "EVENTS" + Consumer anlegen
pnpm worker:materializer              # Materializer-Worker starten (Stub-Handler)
```

Connectors gegen die Pilot-Snapshots in `apps/playground/Dummyfiles/` laufen lassen:

| Script                                                      | Purpose                                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| `pnpm connectors`                                           | alle Sources, JSON auf stdout (legacy)   |
| `pnpm connectors --watch`                                   | dito, watcht das data-dir                |
| `pnpm connectors:slack` / `:jira` / `:intercom` / `:upvoty` | eine Source, Preview oder Publish        |
| `pnpm worker:materializer`                                  | NATS-Subscriber starten                  |
| `pnpm worker:materializer:provision`                        | Stream + Consumer in NATS provisionieren |

**Connector-CLI-Flags** (gilt für `pnpm connectors:<source>`):

| Flag           | Effekt                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| _(kein Flag)_  | Preview-Mode: Emissions auf stdout, kein Netzwerk-IO.                                   |
| `-- --publish` | Live-Publish an NATS-Stream `EVENTS`. Voraussetzung: NATS läuft + Stream provisioniert. |
| `-- --help`    | Volle Usage-Übersicht des Connector-Runners.                                            |
| `[data-dir]`   | Optional positional; Default `apps/playground/Dummyfiles` (relativ zum Repo-Root).      |

> Hinweis: `--` vor dem Flag ist nötig, damit pnpm es nicht selbst interpretiert.

Beispiele:

```bash
pnpm connectors:slack                         # Preview
pnpm connectors:slack -- --publish            # Slack-Snapshot an NATS publizieren
pnpm connectors:jira ./eigener/pfad           # alternatives data-dir
pnpm connectors:slack -- --help               # Help-Output
```

## Layout

```
app/                # Next pages + route handlers
components/ui/      # shadcn components
lib/
  utils.ts          # shadcn cn helper
db/                 # Drizzle schema + client
```

## Pre-commit / pre-push

- **Pre-commit** (husky + lint-staged): prettier + eslint on staged files.
- **Pre-push** (husky): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- CI re-runs everything; don't bypass hooks with `--no-verify`.
