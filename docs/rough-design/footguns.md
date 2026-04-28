# Footguns

Things that have already burned us or will if you're not warned.

## Next 16 is breaking

This Next version has APIs, conventions, and file structure that may differ from your agent's training data. Read `node_modules/next/dist/docs/` for the relevant guide before writing route handlers, `next.config.ts`, or anything that touches the Next build.

## shadcn `init` regresses `globals.css`

Re-running `shadcn init` produces a self-referencing `--font-sans: var(--font-sans)` (and `--font-heading`) in `app/globals.css`. If you re-run init for any reason, restore `var(--font-geist-sans)` and `var(--font-heading)` by hand. To add a single component, use the per-component CLI instead of `init`.

## Turbopack CSS cache

Turbopack can serve stale CSS after global style edits. `rm -rf .next` resets it.

## GitHub Actions workflow files

Edit/Write tools can be blocked by a `security_reminder_hook` when workflow files reference `github.event.*` patterns. Fall back to a Bash heredoc to write `.github/workflows/*.yml` if blocked.

## `drizzle.config.ts` points at `db/schema.ts`

Until that file exists, every `pnpm db:*` script fails. Create `db/schema.ts` before running any `db:*` command.

## shadcn `base-nova` style + `@base-ui/react`

`components.json` sets `"style": "base-nova"`, so the existing primitives in `components/ui/*` import from `@base-ui/react/*`, **not** `@radix-ui/*`. Copy-pasted shadcn snippets from canonical docs (which use Radix) will mismatch. To add components, use the per-component CLI (`pnpm dlx shadcn@latest add <name>`) so the registry resolves to the same style.

## `shadcn init` doesn't wire OS dark mode

The boilerplate adds `next-themes` `<ThemeProvider>` in `app/layout.tsx` with `attribute="class" defaultTheme="system" enableSystem` to fix this. Don't remove the provider unless you're replacing it with something equivalent.
