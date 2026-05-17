# NanoClaw v2 Architecture

NanoClaw is a message-oriented personal-agent runtime. The host and the agent
container communicate through SQLite session databases, not stdin, file
watchers, or direct IPC.

## Core Idea

Everything is a message:

- user chat;
- channel events;
- scheduled tasks;
- webhook payloads;
- system actions;
- agent-to-agent messages;
- tool results.

The host routes and delivers. The container reasons and writes outbound
intentions.

## Runtime Components

### Host

The host process runs outside Docker/Apple Container. It owns:

- `data/v2.db`;
- channel adapters;
- routing;
- user and permission checks;
- session DB lifecycle;
- container spawn/kill;
- delivery;
- recurrence and stale-state sweep;
- OneCLI approval handling.

Key files:

- `src/index.ts`;
- `src/router.ts`;
- `src/session-manager.ts`;
- `src/container-runner.ts`;
- `src/delivery.ts`;
- `src/host-sweep.ts`.

### Agent Container

Each active session wakes an isolated container running:

```text
container/agent-runner/src/index.ts
```

The runner loads `/workspace/agent/container.json`, creates the configured
provider, polls `inbound.db`, and writes `outbound.db`.

## Central DB

The central DB is:

```text
data/v2.db
```

It stores admin-plane state:

```sql
CREATE TABLE agent_groups (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  folder           TEXT NOT NULL UNIQUE,
  agent_provider   TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE container_configs (
  agent_group_id        TEXT PRIMARY KEY REFERENCES agent_groups(id) ON DELETE CASCADE,
  provider              TEXT,
  model                 TEXT,
  effort                TEXT,
  image_tag             TEXT,
  assistant_name        TEXT,
  max_messages_per_prompt INTEGER,
  skills                TEXT NOT NULL DEFAULT '"all"',
  mcp_servers           TEXT NOT NULL DEFAULT '{}',
  packages_apt          TEXT NOT NULL DEFAULT '[]',
  packages_npm          TEXT NOT NULL DEFAULT '[]',
  additional_mounts     TEXT NOT NULL DEFAULT '[]',
  updated_at            TEXT NOT NULL
);

CREATE TABLE messaging_groups (
  id                    TEXT PRIMARY KEY,
  channel_type          TEXT NOT NULL,
  platform_id           TEXT NOT NULL,
  name                  TEXT,
  is_group              INTEGER DEFAULT 0,
  unknown_sender_policy TEXT NOT NULL DEFAULT 'strict',
  created_at            TEXT NOT NULL,
  UNIQUE(channel_type, platform_id)
);

CREATE TABLE messaging_group_agents (
  id                     TEXT PRIMARY KEY,
  messaging_group_id     TEXT NOT NULL REFERENCES messaging_groups(id),
  agent_group_id         TEXT NOT NULL REFERENCES agent_groups(id),
  engage_mode            TEXT NOT NULL DEFAULT 'mention',
  engage_pattern         TEXT,
  sender_scope           TEXT NOT NULL DEFAULT 'all',
  ignored_message_policy TEXT NOT NULL DEFAULT 'drop',
  session_mode           TEXT DEFAULT 'shared',
  priority               INTEGER DEFAULT 0,
  created_at             TEXT NOT NULL,
  UNIQUE(messaging_group_id, agent_group_id)
);

CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,
  agent_group_id     TEXT NOT NULL REFERENCES agent_groups(id),
  messaging_group_id TEXT REFERENCES messaging_groups(id),
  thread_id          TEXT,
  agent_provider     TEXT,
  status             TEXT DEFAULT 'active',
  container_status   TEXT DEFAULT 'stopped',
  last_active        TEXT,
  created_at         TEXT NOT NULL
);
```

The full reference lives in `src/db/schema.ts`; migrations in
`src/db/migrations/` create and evolve the actual DB.

## Session DBs

Each session has a folder:

```text
data/v2-sessions/<agent_group_id>/<session_id>/
```

It contains two SQLite files:

```text
inbound.db
outbound.db
```

### `inbound.db`

Host-owned. The container reads it.

Tables:

- `messages_in`;
- `delivered`;
- `destinations`;
- `session_routing`.

`messages_in` includes routing fields, status, trigger flags, scheduling fields,
recurrence, and task metadata. The host owns `messages_in.status`.

### `outbound.db`

Container-owned. The host reads it.

Tables:

- `messages_out`;
- `processing_ack`;
- `session_state`;
- `container_state`.

The container claims lifecycle progress by writing to `processing_ack`.
The host later syncs those claims to `messages_in.status`.

This two-DB split preserves one clear writer per DB and avoids cross-process
SQLite writer contention.

## Message Flow

1. A channel adapter or CLI submits an inbound event.
2. `routeInbound()` resolves or creates the `messaging_group`.
3. The router resolves user identity and applies access gates.
4. The router finds wired agent groups through `messaging_group_agents`.
5. Engagement mode decides whether the message is a trigger or accumulated
   context.
6. `resolveSession()` finds or creates a session.
7. The host writes a row to `inbound.db.messages_in`.
8. `wakeContainer()` starts or reuses the session container.
9. The runner polls due inbound rows and writes `processing_ack` claims.
10. The runner calls the selected provider.
11. The runner writes `messages_out`.
12. Delivery reads outbound rows, validates destinations, and sends through the
    channel adapter or routes to another agent.

## Session Modes

- `shared`: one session per `(agent_group_id, messaging_group_id)`.
- `per-thread`: one session per `(agent_group_id, messaging_group_id,
  thread_id)`.
- `agent-shared`: one session per `agent_group_id`.

Threaded group adapters force `per-thread` unless the wiring uses
`agent-shared`. DMs collapse thread IDs.

## Container Mounts

The container sees:

```text
/workspace/
  inbound.db
  outbound.db
  outbox/
  .heartbeat
  agent/
    CLAUDE.md
    CLAUDE.local.md
    container.json
  extra/
/app/src/
/app/skills/
```

`container.json` is materialized from `container_configs` before spawn.

Additional mounts are validated by `src/modules/mount-security/index.ts` and
are exposed only under `/workspace/extra/<name>`.

## Provider Model

The runner reads `provider` from `/workspace/agent/container.json`.

Host-side provider modules can contribute environment variables and mounts
needed by that provider. For example, Codex can mount a per-session
`~/.codex/auth.json` or pass `OPENAI_API_KEY`.

## Output Contract

Final provider text is parsed for:

```xml
<message to="destination">...</message>
```

Text outside message blocks is scratchpad. The runner can nudge the provider to
re-send if no deliverable block is present.

MCP tools also write structured outbound rows directly.

## Built-In MCP Tools

Current built-in NanoClaw tools include:

- `send_message`;
- `send_file`;
- `edit_message`;
- `add_reaction`;
- `ask_user_question`;
- `send_card`;
- `schedule_task`;
- `list_tasks`;
- `cancel_task`;
- `pause_task`;
- `resume_task`;
- `update_task`;
- `create_agent`;
- `install_packages`;
- `add_mcp_server`.

Agent-to-agent delivery uses the same destination namespace as channels:

```text
send_message(to: "<agent-name>", text: "...")
```

## Sweep And Recovery

`src/host-sweep.ts` handles:

- waking due messages;
- resetting stale processing claims;
- inspecting heartbeat freshness;
- detecting stuck containers;
- advancing recurring tasks.

The runner touches `.heartbeat`; the host inspects file mtime and
`outbound.db.container_state`.

## Credential Boundary

OneCLI protects external API credentials by injecting them at the gateway. Those
credentials are not handed to the agent as raw files or environment variables.

Provider authentication is separate. A provider may need credentials inside the
container to operate, such as Codex `auth.json` or `OPENAI_API_KEY`.

## Querying State

Use the in-tree query wrapper:

```bash
pnpm exec tsx scripts/q.ts data/v2.db "SELECT id, name, folder FROM agent_groups"
```

Do not require the system `sqlite3` CLI.
