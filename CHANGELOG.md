# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.7] - 2026-11-11

### Fixed

- **Sessions start again.** Computer Use no longer takes over the host's step
  chain, so a message gets an answer instead of failing before the first step
  with `Cannot read properties of undefined (reading 'kind')`.
- **The switch turns back on.** A changed decision now releases the previous
  restriction before applying the new one, so switching Computer Use off and on
  again — or calling the reveal tool — brings the desktop tools straight back
  without restarting DSH.
- **A gate failure can no longer end a turn.** Errors inside the tool gate are
  contained; the step still runs with the model's normal tool list.

## [0.2.6] - 2026-11-11

### Fixed

- **Desktop tools that are hidden are really gone from the request.** With
  Computer Use off — or with lazy tools on and nothing revealed yet — the 18
  `mcp__windows__*` schemas no longer reach the model: each agent's tool scope
  loses them, so a closed switch saves about 4,000 tokens on every turn instead
  of only refusing the call.
- **A failed install now names its cause instead of blaming every mirror.**
  When a dependency has no wheel for the chosen Python (PyYAML on Python 3.15)
  the page shows uv's own error; the installer no longer walks all seven
  mirrors for a failure no mirror can fix. Installs also ask uv for Python 3.14,
  so a machine whose newest interpreter is 3.15 gets a working install instead
  of a compiler error.
- **The settings page saves itself, and a failed save is visible.** Changes are
  written a moment after editing; a failed write shows the reason and "Restore
  defaults" asks before resetting.
- **The screenshot flash checkbox means what it says.** A ticked box now turns
  the border on, instead of storing the opposite of what the label described.
- **"Update available" appears only when an update is really available.** A
  host running the global `uv tool` install no longer reports an update forever.
- **The composer switch matches the composer's own controls** in height, type,
  radius and hover colour, and a reloaded bundle replaces its stylesheet instead
  of leaving new markup on old rules.

### Changed

- **The pill's Chinese copy was tightened.** The tooltip no longer lists a
  capability summary that does not match the exposed tools; it says what the
  switch does, adds "点击重试" only on failure, and keeps the safety note while
  something is exposed. The settings header now carries GitHub, npm and the
  version, and the separate About card and star prompt are gone.
- **README:** `Scrape` is described as fetching a web page, and `Notification`
  as sending a Windows toast.

## [0.2.5] - 2026-11-10

### Changed

- **The composer switch and its tooltip speak the DSH language.** With a
  Chinese DSH the pill reads **AI 控制电脑**; its status line, tooltip and
  accessible name are Chinese too (“AI 正在控制这台电脑 · 6 个桌面工具可用”,
  “AI 未获得控制权 · 桌面工具对模型隐藏，调用会被拒绝”). The wording follows
  DSH's own language setting, so switching the language inside DSH updates the
  pill at once instead of on the next poll. Every other language keeps the
  English copy, and when DSH exposes no language the browser language decides.

## [0.2.4] - 2026-11-08

### Fixed

- **The lazy desktop tools switch stays where you put it.** Turning it off
  keeps it off after saving and after the page reloads, instead of flipping
  back to on while the host already had the change stored.
- **The Desktop entry in the settings rail shows only its own glyph again.**
  The entry carries just its desktop-with-cursor icon; the shell default gear
  no longer appears beside it.

## [0.2.3] - 2026-11-03

### Added

- **Lazy desktop tools (on by default).** The model is offered a single
  `windows_desktop` entry instead of the eighteen `mcp__windows__*` schemas.
  Calling it reveals the capabilities for that session — all of them, or a
  keyword/name subset — and the revealed definitions join the tool table on the
  next step. A hidden tool that gets called anyway is refused with a pointer to
  the entry. Turning the setting off restores the old behaviour: every schema on
  every step.
- The settings page has a **Tool exposure** card for that switch, the doctor
  report prints whether lazy tools are on, and `/state` reports
  `desktopTools: { lazy, revealTool }` for diagnostics.
- **A welcome dialog when the bundle is enabled.** It states the plugin name,
  points at where the dependency and the parameters live (Settings → Desktop)
  and at the composer switch, and offers a prominent *Star on GitHub* button.
  It shows on every explicit enable (the activation card) and once per browser
  otherwise. The dialog is portalled onto `document.body` (so no slot ancestor
  can clip it) as a frosted sheet over a blurred scrim, traps focus, closes on
  Escape/backdrop/button, sizes *Got it* and *Star* identically, and never
  blocks the plugin when the DOM is unavailable.

### Changed

- With Computer Use off, `windows_desktop` is hidden along with every other
  desktop tool, so the entry cannot be used to bypass the switch.

## [0.2.2] - 2026-11-01

### Security

- **Mutating routes require the GUI session cookie.** `/state`, `/prepare`,
  `/prepare/cancel`, `/bridge`, `/update` and `/settings` now refuse a `POST`
  that does not carry the signed cookie the DSH window gets from the
  launch-token exchange (`401`, "this change has to come from the DSH window").
  Until now anything that could reach the loopback port — including a model
  through its own shell — could flip the Computer Use switch for itself.
- `/state` reports `"gate": {"cookie": "enforced" | "unobservable"}` so a
  composition without the `connection` service is visible instead of silent.
- The compositor switch now re-reads the host flag every four seconds and on
  window focus, so it cannot sit on a stale value after the flag changed
  elsewhere.


### Fixed

- **A fresh install can no longer hang DSH's startup.** The bridge row used to
  start as `uvx windows-mcp@0.8.8`, which resolves the entire Python dependency
  tree from the package index on first launch. Behind a slow or blocked network
  that resolve sat inside the host's plugin boot for minutes — the window stayed
  on “Loading plugins…” and DSH logged a crash. The bundle patch now ships the
  bridge row with `disabled: true`, so boot never runs `uvx` or touches the
  network; the dependency is installed from **Settings → Desktop**, which
  rewrites the row with `disabled: false` and an absolute `command:` and asks for
  one restart.
- The machine-written profile block now restates `disabled: false`. Without it
  the block would override `config` while the bundle layer's `disabled: true`
  stayed in effect, leaving a profile with no Windows tools at all.
- `windows_mcp_doctor` and the startup audit now explain this sequence, and the
  boot warnings no longer claim `uv`/`uvx` is needed to *start* the bridge (it is
  only needed to install the dependency).

- **The Computer Use switch no longer freezes at its first render.** The pill
  used to read `/state` once on mount, so a flag changed elsewhere (the
  settings page, an installer run, another window) left the switch showing a
  position the host no longer had. It now re-reads the host every 4 seconds and
  whenever the window regains focus, and stays quiet while its own write is in
  flight.

### Changed

- **The dependency UI moved into the settings page.** Install / reinstall /
  update / roll back / “Point the bridge at it”, the live installer log and the
  patch target now live in the **Dependency** card of **Settings → Desktop**,
  next to the bridge knobs they affect. The plugin's own card keeps a one-line
  status that points there; the activation prompt shown after enabling the
  bundle still offers the install button.

### Added

- README (EN/zh): “boot is never blocked by the dependency”, how the two-step
  install works, and a `uv.toml` mirror snippet for restricted networks.

## [0.2.1] - 2026-10-29

### Added

- **Settings page** (`lib/settings.js`, the `settings.section` slot): a new
  **Settings → Desktop** entry whose page groups the knobs into
  **Bridge** (`toolCallTimeoutMs`, screenshot scale/backend, flash overlay,
  the excludable tools), **Updates** (check on boot, preferred mirror) and
  **About** (version, repository, a **Star** button). Values are validated and
  clamped, stored atomically in `$DSH_HOME/dsh-windows-mcp.settings.json`, and
  bridge changes are written into the profile's bridge row with a backup; the
  page reports when a restart is needed.
- `preferredMirror`: the update check can pin a mirror while `auto` keeps the
  measured ranking.
- The settings entry now wears a monitor-and-cursor glyph instead of the
  shell's gear: the `settings.section` slot has no icon field, so the icon is
  painted as a `currentColor` mask on the settings nav row, matched by the
  entry's own localized label.

### Fixed

- Reading the bridge row now treats a missing `WINDOWS_MCP_DISABLE_FLASH`
  inside the machine-written block as "flash enabled", not as unknown.
- `mirrorOrder` had a stray spacing glitch on its declaration line.
## [0.2.0] - 2026-10-24

### Added

- **Windows-MCP version management** (`lib/updater.js`, `lib/installs.js`): the
  plugin checks the mirrors for the newest stable `windows-mcp`, installs a
  version **side by side** under `$DSH_HOME/dsh-windows-mcp/toolchain/<version>`
  (each version its own `UV_TOOL_DIR`, so nothing is overwritten), rewrites the
  bridge row to the freshly installed executable, and keeps the replaced version
  so **Roll back** switches back to it without downloading anything. The check
  result, active/previous version and the install history are persisted in
  `$DSH_HOME/dsh-windows-mcp.versions.json`. Checks run on boot and are cached
  for six hours.
- **Fast-mirror selection for the Python dependency** (`lib/mirrors.js`,
  `lib/pypi.js`): PyPI plus the USTC, Aliyun, Tencent Cloud, Huawei Cloud,
  Nanjing University and TUNA mirrors are probed with a 96 KiB ranged read and
  ranked by measured throughput; the install uses the fastest working mirror and
  falls back to the next candidate on failure.
- On the plugin page: running version, newest version, kept versions, the
  measured mirror speed, and **Check for updates** / **Update to vX** / **Roll
  back to vPrev** actions, with the streamed `uv` log.
- `tools/update-e2e.mjs`, a maintainer harness that runs the real check, install,
  activation and rollback against this machine's profile (never published).

### Changed

- `createPrepare` / the prepare route now install into the managed tool root
  through `UV_TOOL_DIR`, support a chosen `--default-index` mirror, and resolve
  the executable from the version that was installed.
- `uv` installs set `UV_CONCURRENT_DOWNLOADS=4`, `UV_HTTP_RETRIES=3` and
  `UV_HTTP_TIMEOUT=600`: at uv's default of eight parallel downloads the mirrors
  answer HTTP 429 and the install fails.
- The bridge-row writer, the doctor report and the `/state` payload all report
  which side is live (`managed` vs the global `uv-tool` install).

### Fixed

- The PyPI index parser dropped files whose link carried a `#sha256=…` fragment
  (every wheel on a real mirror), so the newest version looked missing.
- The version pin regex stopped at YAML punctuation but not at the backtick used
  in the written block's prose comment.

## [0.1.0] - 2026-10-11

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
