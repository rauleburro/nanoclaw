# Agent Guidance Files

NanoClaw keeps project-development guidance separate from runtime agent
instructions.

## Canonical Files

- `AGENTS.md` is the canonical project instruction file for Codex and other
  coding agents.
- `CLAUDE.md` is a Claude Code compatibility shim that points to `AGENTS.md`.
- `.codex/config.toml` contains repo-local Codex configuration. It must not
  contain secrets or user-local authentication.

## Development Skills

Development-agent skills live in `agent-skills/`.

Two discovery paths point at the same canonical directory:

```text
.claude/skills -> ../agent-skills
.agents/skills -> ../agent-skills
```

Edit `agent-skills/<name>/` when changing a development skill. Do not edit the
symlink paths as if they were separate copies.

## Runtime Skills

`container/skills/` is separate. Those skills are mounted into NanoClaw agent
containers and influence the assistant that runs inside NanoClaw. They are not
the project-development skills used by Codex or Claude Code while editing this
repository.
