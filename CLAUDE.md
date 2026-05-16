# Claude Code Compatibility

Claude Code users should read [AGENTS.md](AGENTS.md). That file is the
canonical project guidance for this repository and is shared with Codex and
other coding agents.

## Stop Before Merging v1 Installs

If you just ran `git pull`, `git merge`, `git fetch && git merge`, or any
equivalent command to bring upstream changes into an existing NanoClaw v1
install, and you see merge conflicts or a large diff involving this file, stop.

NanoClaw v2 is a ground-up rewrite with breaking changes throughout. It cannot
be merged into an existing v1 install by resolving conflicts by hand.

Do this instead:

1. Abort the merge with `git merge --abort`, or `git reset --hard ORIG_HEAD` if
   the merge already completed.
2. Tell the user exactly: "This is the v2 rewrite - it can't be merged into your
   existing install. Exit Claude Code (or open a separate terminal) and run
   `bash migrate-v2.sh` from the shell."
3. Wait for the user to confirm before doing anything else. Do not run the
   migration script from inside Claude Code; it requires an interactive terminal.

If this is a fresh install or a normal v2 checkout with no conflicts, continue
with [AGENTS.md](AGENTS.md).
