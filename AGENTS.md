# NanoClaw

NanoClaw is a personal AI assistant runtime. The host is a single Node process
that routes platform messages into per-session SQLite inboxes, wakes isolated
agent containers, and delivers outbound messages through channel adapters.

This file is the canonical project guidance for coding agents. `CLAUDE.md` is a
Claude Code compatibility shim. Development-agent skills live in
`agent-skills/`, with compatibility symlinks from `.claude/skills` and
`.agents/skills`.

## Stop Before Merging v1 Installs

If you just pulled or merged upstream changes into an existing NanoClaw v1
install and see conflicts or a large diff, stop. NanoClaw v2 cannot be merged
into v1 by resolving conflicts manually.

Tell the user: "This is the v2 rewrite - it can't be merged into your existing
install. Exit this agent (or open a separate terminal) and run
`bash migrate-v2.sh` from the shell."

Do not run the migration script from inside the coding agent.

## Architecture

Everything is a message. The host and container communicate through session DBs,
not stdin, file watchers, or direct IPC.

- Central DB: `data/v2.db`, with users, roles, groups, wirings, container config,
  approvals, and migrations under `src/db/migrations/`.
- Session DBs: `data/v2-sessions/<agent_group_id>/<session_id>/inbound.db` and
  `outbound.db`. The host writes inbound and reads outbound; the container does
  the reverse.
- Agent groups: persistent workspaces under `groups/<folder>/`, with composed
  runtime instructions, memory, and materialized `container.json`.
- Containers: spawned by `src/container-runner.ts`, run
  `container/agent-runner/src/index.ts`, and poll session DBs.

Key areas:

- `src/index.ts`: host entry point, DB init, channel adapters, delivery, sweep.
- `src/router.ts`: inbound platform message routing.
- `src/delivery.ts`: outbound delivery and system action handling.
- `src/host-sweep.ts`: stale detection, due-message wake, recurrence.
- `src/container-runner.ts`: container mounts, provider env, OneCLI gateway.
- `src/cli/`: `ncl` local/admin CLI.
- `container/agent-runner/src/`: in-container poll loop, formatter, providers,
  MCP tools, destinations.
- `container/skills/`: runtime skills mounted into agent containers.
- `agent-skills/`: repo-development skills for coding agents.

## Development Rules

- Prefer existing patterns over new abstractions.
- Keep changes scoped to the requested behavior.
- Do not revert user changes or unrelated dirty work.
- Do not include installation-local files in commits: generated group files,
  `.claude/settings.json` edits, data, logs, local configs, or secrets.
- Before changing contribution or skill behavior, read [CONTRIBUTING.md](CONTRIBUTING.md).
- Use `rg` for search.
- Use `pnpm exec tsx scripts/q.ts <db> "<sql>"` for ad-hoc SQLite queries; do
  not assume the `sqlite3` CLI exists.

## Skills

Development-agent skills are centralized in `agent-skills/`.

- `.claude/skills` is a symlink for Claude Code compatibility.
- `.agents/skills` is a symlink for Codex skill discovery.
- `container/skills/` is separate; those skills run inside NanoClaw agent
  containers and are selected through container config.

When adding or updating a development skill, edit `agent-skills/<name>/`.

## Commands

Run commands directly when working in this repo.

```bash
pnpm run build
pnpm run typecheck
pnpm test
pnpm run lint
./container/build.sh
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
cd container/agent-runner && bun test
```

Use the focused checks that match the files you touched. If you edit
`container/agent-runner/src/`, run the container typecheck. If you edit host
TypeScript, run `pnpm run typecheck`.

## Admin CLI

`ncl` manages groups, messaging groups, wirings, users, roles, members,
destinations, sessions, dropped messages, and approvals.

```bash
ncl <resource> <verb> [<id>] [--flags]
ncl <resource> help
ncl help
```

Container config lives in the central DB and is materialized to
`groups/<folder>/container.json` at spawn time. Manage it through
`ncl groups config ...`.

## Providers And Channels

Trunk contains the registry and infrastructure. Specific channel adapters and
non-default providers are installed from long-lived branches or skills. Do not
mix project-guidance migration with runtime provider installation unless the
user explicitly asks.

## PR Hygiene

Before preparing a PR or push, show:

```bash
git diff upstream/main --stat HEAD
git log upstream/main..HEAD --oneline
```

Review the diff for local installation files. Group files, data, logs, local
agent settings, and generated runtime artifacts should not be included unless
the task specifically requires them.
