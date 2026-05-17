# NanoClaw Agent Runner Details

The agent runner is the program executed inside each NanoClaw agent container.
It is provider-neutral: it polls session DBs, formats messages, exposes MCP
tools, calls the selected provider, and writes outbound rows.

## Startup

The runner starts from:

```text
container/agent-runner/src/index.ts
```

It reads:

```text
/workspace/agent/container.json
```

The config file is materialized by the host from `container_configs` before the
container starts. Important fields:

- `provider`;
- `assistantName`;
- `groupName`;
- `agentGroupId`;
- `maxMessagesPerPrompt`;
- `mcpServers`;
- `model`;
- `effort`.

The runner does not receive the initial prompt over stdin. It reads pending
messages from `/workspace/inbound.db`.

## Mount Layout

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

`inbound.db` is host-owned. `outbound.db` is container-owned.

## Provider Interface

Current provider modules registered in the container provider barrel are:

- `claude`;
- `codex`;
- `mock`.

Other providers, such as OpenCode, are optional when installed by skills.

The provider interface is:

```typescript
interface AgentProvider {
  readonly supportsNativeSlashCommands: boolean;
  query(input: QueryInput): AgentQuery;
  isSessionInvalid(err: unknown): boolean;
}

interface QueryInput {
  prompt: string;
  continuation?: string;
  cwd: string;
  systemContext?: { instructions?: string };
}

interface AgentQuery {
  push(message: string): void;
  end(): void;
  events: AsyncIterable<ProviderEvent>;
  abort(): void;
}

type ProviderEvent =
  | { type: 'init'; continuation: string }
  | { type: 'result'; text: string | null }
  | { type: 'error'; message: string; retryable: boolean; classification?: string }
  | { type: 'progress'; message: string }
  | { type: 'activity' };
```

`continuation` is opaque. Claude may use a session/transcript identifier; Codex
uses a thread identifier. The poll loop stores it per provider so a continuation
from one backend is not reused by another.

Providers must yield `activity` on underlying SDK events so the poll loop and
host liveness logic do not mistake long work for a stuck container.

## Poll Loop

The loop in `poll-loop.ts`:

1. reads due pending rows from `inbound.db.messages_in`;
2. skips system rows as direct agent input;
3. does not process batches that contain only `trigger=0`;
4. writes `processing` claims to `outbound.db.processing_ack`;
5. formats messages;
6. calls `provider.query()`;
7. polls for follow-up messages during the active query;
8. writes result messages to `outbound.db.messages_out`;
9. writes completion/failure claims to `processing_ack`.

The host owns `messages_in.status` and syncs state from `processing_ack`.

## Message Formatting

`formatter.ts` converts inbound rows into XML-like prompt text and includes the
local timezone:

```xml
<context timezone="Europe/Madrid" />
<message from="terminal" sender="Raul" time="...">...</message>
<task time="...">...</task>
<webhook source="..." event="...">...</webhook>
```

Routing fields are not exposed directly to the model. Destination names are
resolved separately through the session destination map.

## Output Contract

Provider final text is parsed for:

```xml
<message to="destination-name">...</message>
```

Text outside message blocks is treated as scratchpad. If no deliverable message
block exists, the poll loop can push a corrective system nudge asking the
provider to re-send using the required wrapper.

## Built-In MCP Tools

The built-in NanoClaw MCP server is registered as `nanoclaw`.

Tools include:

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

Outbound tools write rows to `outbound.db`. Read-only tools may read
`inbound.db`.

## Agent-To-Agent

There is no separate `send_to_agent` tool. Agents and channels share a
destination namespace, so agent-to-agent delivery uses:

```typescript
send_message({ to: "agent-name", text: "..." })
```

The host delivery layer recognizes agent destinations and routes them to the
target agent session.

## Scheduling

Scheduling tools emit system actions into `outbound.db`. The host applies those
actions to durable inbound task rows. This preserves the ownership rule:

- host mutates inbound task state;
- container requests changes through outbound system actions.

Recurring tasks are advanced by host sweep.

## Interactive Questions

`ask_user_question` writes an outbound question card and blocks while polling
for a matching response row in `inbound.db`. When the answer arrives, the runner
marks that response completed through `processing_ack`.

## Provider Notes

### Claude

The Claude provider wraps `@anthropic-ai/claude-agent-sdk`, supports native
slash commands, configures MCP servers directly, and uses hooks for tool
liveness and transcript archiving.

### Codex

The Codex provider wraps `codex app-server` over JSON-RPC. It writes MCP config
to `~/.codex/config.toml`, starts or resumes a Codex thread, translates app
server notifications to provider events, and auto-approves app-server approval
requests because the container is already the sandbox boundary.

Codex does not expand Claude `@file` imports automatically, so the provider
resolves `CLAUDE.md` / `CLAUDE.local.md` imports before passing base
instructions to Codex.

## Liveness

The runner touches:

```text
/workspace/.heartbeat
```

The host checks heartbeat mtime plus `outbound.db.container_state` to detect
stuck containers and long-running tools.
