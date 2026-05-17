# NanoClaw v2 Specification

NanoClaw is a local personal-agent runtime. A persistent host process receives
messages from channel adapters, routes them into durable SQLite session inboxes,
wakes isolated agent containers, and delivers outbound messages back through the
host.

## Runtime Shape

```text
platform / CLI
  -> host process
  -> data/v2.db
  -> data/v2-sessions/<agent_group_id>/<session_id>/inbound.db
  -> agent container
  -> selected provider
  -> outbound.db
  -> host delivery
  -> platform / CLI
```

The host is trusted orchestration. The container is the agent sandbox.

## Host Process

The host runs `dist/index.js` as a local service. On macOS setup installs a
LaunchAgent; on Linux setup uses systemd when available and a nohup wrapper as a
fallback.

The host owns:

- channel adapters and CLI socket;
- central DB initialization and migrations;
- message routing;
- session DB creation;
- container spawning and teardown;
- outbound delivery;
- scheduled task and recurrence sweep;
- OneCLI approval handling;
- mount validation.

## Central DB

The central DB is:

```text
data/v2.db
```

It stores admin-plane state:

- `agent_groups`;
- `container_configs`;
- `messaging_groups`;
- `messaging_group_agents`;
- `users`, `user_roles`, `agent_group_members`, `user_dms`;
- `sessions`;
- pending questions and approvals;
- dropped-message audit state;
- migration records.

Container config source of truth is `container_configs`. At spawn time the host
materializes that row to:

```text
groups/<folder>/container.json
```

That file is a runtime artifact read by the in-container runner.

## Routing Model

`messaging_groups` represent external conversations: DMs, groups, channels,
threads, issues, PRs, and local CLI conversations.

`agent_groups` represent persistent agents: workspace, memory, instructions, and
container configuration.

`messaging_group_agents` wires the two together. Current routing fields are:

- `engage_mode`: `pattern`, `mention`, or `mention-sticky`;
- `engage_pattern`: regex for pattern mode;
- `sender_scope`: `all` or `known`;
- `ignored_message_policy`: `drop` or `accumulate`;
- `session_mode`: `shared`, `per-thread`, or `agent-shared`;
- `priority`.

## Session DBs

Each session has a directory:

```text
data/v2-sessions/<agent_group_id>/<session_id>/
  inbound.db
  outbound.db
  outbox/
  .heartbeat
```

`inbound.db` is host-owned. It contains:

- `messages_in`;
- `delivered`;
- `destinations`;
- `session_routing`.

`outbound.db` is container-owned. It contains:

- `messages_out`;
- `processing_ack`;
- `session_state`;
- `container_state`.

The container reads `inbound.db` and writes lifecycle claims to
`outbound.db.processing_ack`. The host owns and syncs
`messages_in.status`.

Use the project query wrapper for ad-hoc inspection:

```bash
pnpm exec tsx scripts/q.ts data/v2.db "SELECT id, name, folder FROM agent_groups"
```

Do not assume the `sqlite3` CLI exists.

## Session Modes

- `shared`: one session per `(agent_group_id, messaging_group_id)`, threads
  collapsed.
- `per-thread`: one session per `(agent_group_id, messaging_group_id,
  thread_id)`.
- `agent-shared`: one session per `agent_group_id`, shared across messaging
  groups/channels.

Threaded group traffic is forced to `per-thread` unless the wiring is
`agent-shared`. DMs collapse thread IDs.

## Agent Container

The container mounts a session workspace and the agent group workspace. Important
paths:

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

Additional host mounts are validated through the mount allowlist and exposed
under `/workspace/extra/<name>`.

## Agent Runner

The runner lives in `container/agent-runner/src/`.

It:

1. loads `/workspace/agent/container.json`;
2. creates built-in and configured MCP servers;
3. creates the selected provider;
4. polls `inbound.db` for due messages;
5. writes processing/completion claims to `outbound.db.processing_ack`;
6. formats messages for the provider;
7. writes outbound chat/system/file rows to `outbound.db`;
8. keeps `.heartbeat` fresh for host liveness checks.

## Providers

Provider selection is read by the runner from the materialized
`container.json`.

Built-in/current providers include:

- `claude`;
- `codex`;
- `opencode` when installed;
- `mock` for tests.

Provider auth may be provider-specific. OneCLI protects proxied external API
credentials, but provider credentials such as Codex `auth.json` or
`OPENAI_API_KEY` can be mounted/passed into the container when required.

## MCP Tools

Built-in NanoClaw MCP tools include:

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

Agent-to-agent messages use `send_message(to: "<agent-name>", text: "...")`.
There is no separate `send_to_agent` tool in current code.

## Scheduling

Scheduling is represented as task rows and system actions. The container does
not mutate inbound task state directly; it emits actions through `outbound.db`,
and the host applies durable changes.

Recurring tasks are advanced by host sweep logic.

## Delivery

The host delivery loop reads `messages_out`, checks destination permissions,
handles system actions, sends channel messages through adapters, and records
delivery state. Agent-to-agent routing is also handled by host delivery.

## Security

Primary boundaries:

- host vs container;
- per-agent group filesystem;
- per-session DBs;
- mount allowlist;
- OneCLI gateway and approval flow;
- user roles and memberships.

External credentials managed by OneCLI are not handed to the agent as raw
secrets. Provider auth is separate and must be evaluated per provider.
