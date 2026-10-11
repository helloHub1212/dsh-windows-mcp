# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-10

### Added

- Carrier bundle that mounts the official in-box MCP client bridge
  (`@deepseek-ai/dsh-mcp-client`) against CursorTouch/Windows-MCP over stdio,
  exposing Windows desktop automation to DeepSeek Harness as
  `mcp__windows__*` tools (screenshot, snapshot, click, type, scroll, move,
  shortcut, wait, wait-for, scrape, multi-select, multi-edit, clipboard,
  process, notification, registry, display inventory, control status).
- Curated defaults: `App`, `PowerShell` and `FileSystem` excluded (DSH already
  ships shell and file tools, and upstream only supports the App tool reliably
  on English Windows), telemetry disabled, screenshot flash disabled,
  screenshots downscaled to 0.75, 120 s per-call timeout, reconnect enabled.
- Host half (`lib/index.js`) with a `windows_mcp_doctor` diagnostic tool and a
  single-warning startup audit (missing patch row, missing `uv`/`uvx`).
- Zero runtime dependencies; `js-yaml` is a dev dependency used only by tests
  to parse the patch file for real.
- A **Computer Use** switch in the composer tool row (client half,
  `lib/client.js`): renders the number of bridged desktop tools and persists the
  choice in `~/.dsh/dsh-windows-mcp.state.json`. It is **off by default** —
  desktop control is opt-in, so a fresh install does not hand the agent the
  machine until the switch is turned on.
- Hard enforcement of that switch (host half): while it is off, every
  `mcp__windows__*` tool is filtered out of the prompt assembly the model sees
  and refused by a plain-context `tools.guard()` at dispatch — for every session
  and subagent, live, without a restart. `tools.restrict()` is deliberately not
  used: it requires a per-agent scoped context and throws for tools the bridge
  has not registered yet.
- An in-app dependency installer (`lib/dependency.js`, plus the
  `plugins.bundle.config` and `plugins.bundle.activation` client slots — the same
  two the official experimental bundles use): dependency state, one install
  button, streamed `uv tool install` output with cancel, and — after a
  successful install — an automatic, backed-up, idempotently marked rewrite of
  the bridge row in the profile's `cordis.patch.yml` that points it at the
  installed executable.
- Profile targeting for that rewrite, shown in the page as **Patch target**: the
  plugin resolves the profile the host booted (from `DSH_WINDOWS_MCP_PROFILE`,
  `DSH_PROFILE_DIR`, `DSH_PROFILE`, a `--profile` argument or the working
  directory) so an install in a `dsh --profile <name>` host edits *that* profile.
  When several profiles carry the package and the host reports none of them, it
  writes nothing and points at `DSH_WINDOWS_MCP_PROFILE` instead of guessing.
- GitHub Actions CI running the test suite on Windows and Linux, Node 22 and 24.
