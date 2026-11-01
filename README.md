# dsh-windows-mcp

**English** · [中文](https://github.com/helloHub1212/dsh-windows-mcp/blob/main/README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-windows-mcp.svg)](https://www.npmjs.com/package/dsh-windows-mcp)
[![CI](https://github.com/helloHub1212/dsh-windows-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/helloHub1212/dsh-windows-mcp/actions/workflows/ci.yml)

**Windows desktop automation for [DeepSeek Harness](https://github.com/sandbaseai/deepseek-harness-handbook)** — lets the DSH agent see your screen and drive your PC.

This plugin connects [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) to DSH by mounting one loader row against the **MCP client bridge that already ships inside DeepSeek Harness**. There is no reimplemented protocol client and no second copy of the MCP SDK: the plugin is a *carrier bundle*, and everything you can do comes from the official bridge.

```text
DSH agent
  └─ tool call  mcp__windows__Screenshot
       └─ @deepseek-ai/dsh-mcp-client        (in-box, mounted by this plugin's patch row)
            └─ uvx windows-mcp@0.8.8 serve   (stdio child process)
                 └─ your desktop: UIA tree, Win32 input, screen capture
```

## What it gives the agent

With the plugin installed and Windows-MCP reachable, these tools appear in the tool list:

| Tool | What it does |
| --- | --- |
| `mcp__windows__Screenshot` | Capture the screen; the image lands in the conversation as a real attachment |
| `mcp__windows__Snapshot` | Capture an accessibility tree (text, no image tokens) |
| `mcp__windows__DisplayInventory` | Enumerate displays and their geometry |
| `mcp__windows__Click` / `Move` / `Scroll` | Mouse input |
| `mcp__windows__Type` / `Shortcut` | Keyboard input |
| `mcp__windows__Wait` / `WaitFor` | Sleep, or wait until a UI condition holds |
| `mcp__windows__Scrape` | Extract text from a window |
| `mcp__windows__MultiSelect` / `MultiEdit` | Batch element selection / batch edits |
| `mcp__windows__Clipboard` | Read and write the clipboard |
| `mcp__windows__Process` | List, start and stop processes |
| `mcp__windows__Notification` | Read notifications |
| `mcp__windows__Registry` | Read and write registry values |
| `mcp__windows__ControlStatus` | Control-loop state. **Cannot be disabled** — upstream force-keeps it |
| `mcp__windows__App` | Launch/switch apps. *Excluded by default* (upstream only supports it reliably on an English Windows install) |
| `mcp__windows__PowerShell` / `FileSystem` | *Excluded by default* — DSH already ships shell and file tools |

Plus one tool of its own, `windows_mcp_doctor`, which explains what is wrong when the `mcp__windows__*` tools are missing.

The composer also gains a **Computer Use** pill, next to the permission control: it shows how many desktop tools are actually registered and remembers your choice across restarts (state file: `~/.dsh/dsh-windows-mcp.state.json`). It starts **off** — a fresh install never hands the agent your desktop until you switch the pill on yourself.

Switching it off is a hard switch, not a hint. The bridge keeps running, but from the next step on every `mcp__windows__*` tool is filtered out of the tool list the model sees, and a call that still names one is refused at dispatch — in every session and subagent, live, with no restart. Switch it back on and they return immediately; `windows_mcp_doctor` always reports which way it is set.

> **Verified:** Windows 11 + DSH Desktop 0.2.0-rc.2 — the bridged server advertises
> **18 tools** (the 21 upstream tools minus the three excluded here) and is ready
> about 1.5 s after launch. The bridge publishes each as `mcp__windows__<ToolName>`.

## Requirements

- **Windows 10/11.**
- **DeepSeek Harness Desktop** with the in-box `@deepseek-ai/dsh-mcp-client` bridge (0.2.0-rc.2 or newer).
- **[uv](https://docs.astral.sh/uv/)** on the `PATH` of the process that runs DSH — **Settings → Desktop** uses it to install Windows-MCP. DSH itself boots without it. `%USERPROFILE%\.local\bin` is searched even when it is not on `PATH`.
- **A model that accepts image input** if you want the agent to actually *see* screenshots.

### Boot is never blocked by the dependency

The bridge row ships **disabled**, on purpose. A `uvx`-style first launch
resolves Windows-MCP's Python dependencies from the package index, and on a slow
or blocked network that resolve can sit inside DSH's startup for minutes — the
window stays on “Loading plugins…”. A plugin must never be able to do that to
its host, so:

- **First boot after installing the bundle:** DSH starts normally, no Windows
  tools yet, and the dependency is reported as *not installed* — both on the
  Plugins page and in **Settings → Desktop**.
- **Install it from Settings → Desktop** (next section). It probes PyPI mirrors,
  installs into the plugin's own toolchain directory, and rewrites the bridge row
  with `disabled: false` and `command:` pointing at the installed executable.
- **Restart DSH once.** From then on the bridge spawns the exe directly — on
  Windows 11 the server is ready about **1.5 s** after launch, with no network.

`uv` is only needed by the installer. On a restricted network, point `uv` at a
mirror once (`%APPDATA%\uv\uv.toml`) and the manual/CLI paths get the same
speed-up:

```toml
default-index = "https://mirrors.aliyun.com/pypi/simple"
```

## Install

The plugin is a normal DSH bundle. Install it with DSH's own plugin manager:

1. Open **DSH Desktop → Settings → Plugins**.
2. Add the bundle, pointing at either the published package name, the repository (`github:helloHub1212/dsh-windows-mcp`), or a local checkout of this repo.
3. **Restart DSH** so the new patch layer is composed at startup.

For non-Electron profiles the CLI does the same thing:

```powershell
dsh plugin --profile <profile> add github:helloHub1212/dsh-windows-mcp
```

> The Electron app owns the `desktop` profile; the CLI refuses every command against it, including read-only ones. Use the GUI for `desktop`.

### Install the dependency from the app

Windows-MCP itself is a Python program, so the **Dependency** card in **Settings → Desktop** shows its state and installs it for you:

- **Dependency** — `installed 0.8.8`, or *not installed*, or *uv not found*.
- **Download and install** — runs `uv tool install windows-mcp@<pinned>` once (through the fastest mirror), streams the installer output into the page, and offers **Cancel** while it runs.
- When it finishes, the plugin **writes the bridge row into your profile's `cordis.patch.yml` itself** — after a timestamped backup, inside idempotent markers — with `disabled: false` and `command:` pointing at the installed executable. **Restart DSH** to apply that; from then on the bridge launches the exe directly and never resolves a package index during boot.

The block it writes is the row documented under [Pin a local interpreter instead of `uvx`](#pin-a-local-interpreter-instead-of-uvx); delete the marked block to return to the inert, `uvx`-based row. The plugin's own page in **Settings → Plugins** keeps a one-line status that points here, and the activation prompt shown after enabling the bundle offers the same install button.

The page also shows the **Patch target**: the `cordis.patch.yml` a manual write would touch, which is the profile this host booted — including a `dsh --profile web` host. If this package sits in more than one profile and the host does not report which one it started, the plugin writes nothing and says so instead of guessing: set `DSH_WINDOWS_MCP_PROFILE=<profile name>` (or an absolute profile directory) for the process that runs DSH and retry.

### Update Windows-MCP, and roll back

The same page manages the upstream version, so an upgrade never means reinstalling the dependency by hand:

- **It checks by itself.** On boot, and whenever the page asks, the plugin probes the PyPI mirrors, takes the fastest one that answers and reads its `windows-mcp` index. The result is cached for six hours in `$DSH_HOME/dsh-windows-mcp.versions.json`, so restarts do not hammer the network.
- **Versions live side by side.** Every version is installed into its own tool root, `$DSH_HOME/dsh-windows-mcp/toolchain/<version>/windows-mcp`, through `UV_TOOL_DIR`. Activating a version only rewrites the bridge row (backed up, as above): no reinstall, and the previous version stays on disk.
- **Update in one click.** **Update to vX** downloads that version from the fastest mirror that works, verifies the executable and its `dist-info`, then activates it — the panel names the running version and the mirror it came from.
- **Roll back the same way.** **Roll back to vPrev** points the bridge back at the version the active one replaced; nothing is downloaded.

Only managed installs are used by the bridge: it stays disabled until an install (or **Point the bridge at it**) rewrites the row with a real executable, and the panel says which side is live (`uv-tool` vs `managed`).

### Fast mirrors for the Python dependency

The check measures all seven candidates — PyPI plus the USTC, Aliyun, Tencent Cloud, Huawei Cloud, Nanjing University and TUNA mirrors — with a 96 KiB ranged read, and ranks them by throughput. An install uses the fastest mirror that works and falls back to the next one when a mirror fails, with `UV_CONCURRENT_DOWNLOADS=4`, `UV_HTTP_RETRIES=3` and `UV_HTTP_TIMEOUT=600`, because mirrors rate-limit uv's default of eight parallel downloads (HTTP 429). A mirror that has blocked this network is ranked out instead of failing the install; the measured speed is shown per mirror in the panel.

### Settings page and the star button

Everything above, plus a few knobs that do not belong on a plugin card, lives in **Settings → Desktop** — a new entry in the settings sidebar, next to the other plugins' pages:

- **Dependency** — install, reinstall, update, roll back, and a **Point the bridge at it** action, with the live installer log and the patched row's target. The plugin's own page only carries a pointer to this card.
- **Bridge** — `toolCallTimeoutMs`, the screenshot scale, the capture backend, upstream's flash overlay, and the three tools the bridge may exclude (`App`, `PowerShell`, `FileSystem`). These are written into the bridge row of your profile's `cordis.patch.yml` (timestamped backup first), so **they apply after DSH restarts**; the page states which row is in effect.
- **Updates** — whether the plugin checks for a newer Windows-MCP on boot, and the mirror policy: `auto` keeps the measured ranking, an explicit mirror pins it, and the official index always stays as the last resort.
- **About** — the plugin version, the repository link, and a **Star** button that opens the project on GitHub in a new tab.

Saving is atomic (`$DSH_HOME/dsh-windows-mcp.settings.json`). A value out of range is clamped to its default and reported instead of being written silently, and a change that leaves the bridge row untouched does not rewrite the patch layer at all. **Revert** restores the defaults in the form.
## Verify

```text
windows_mcp_doctor
```

Prints the resolved `uv`/`uvx`/`python`, the state of `%USERPROFILE%\.windows-mcp`, the effective bridge row, and the `mcp__windows__*` tools that are actually registered. Then ask the agent:

> Take a screenshot of my desktop and tell me what is on screen.

## Configuration

The defaults live in [`cordis.patch.yml`](cordis.patch.yml). Everything below is set through the `env` block of the `windows-mcp-bridge` row.

| Variable | Default here | Effect |
| --- | --- | --- |
| `WINDOWS_MCP_SCREENSHOT_SCALE` | `0.75` | Screenshot downscale, `0.1`–`1.0`. The single biggest lever on image token cost. |
| `WINDOWS_MCP_DISABLE_FLASH` | `1` | Suppresses upstream's orange "control taken over" border on every capture. |
| `WINDOWS_MCP_SCREENSHOT_BACKEND` | `auto` | Capture backend; see upstream docs before overriding. |
| `WINDOWS_MCP_MAX_TREE_ELEMENTS` | `500` | Cap on the accessibility-tree size reported by `Snapshot`. |
| `WINDOWS_MCP_WATCHDOG` | `off` | Upstream watchdog. Off by default because the UIA event pump can take the whole process down ([upstream #332](https://github.com/CursorTouch/Windows-MCP/issues/332)). |
| `ANONYMIZED_TELEMETRY` | `false` | Upstream defaults to **on** (PostHog). This plugin turns it off. |

### Override the row from your profile

Do not edit the plugin's own file — patch the row by id from your profile's
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`, which is composed *after* bundle
rows and therefore wins.

**A patch replaces the whole `config` object; it does not deep-merge it.** The
loader applies overrides as `target[key] = value` (`applyEntryPatches` in
`dsh-app-boot`), so a key you leave out is a key you delete: `serverName` is
required (and names every tool), `transport` is required, `command` is required
for `stdio`, `url` for `streamable-http`. A patch whose `id` does not exist, or
whose `name` does not match, is skipped with a warning instead of failing.

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml — the complete row
- id: windows-mcp-bridge
  config:
    serverName: windows
    transport: stdio
    command: uvx
    args: [windows-mcp@0.8.8, serve, --exclude-tools, "App,PowerShell,FileSystem"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    env:
      ANONYMIZED_TELEMETRY: "false"
      WINDOWS_MCP_DISABLE_FLASH: "1"
      WINDOWS_MCP_SCREENSHOT_SCALE: "0.5"
```

`--exclude-tools` takes its names as one comma-separated argument
(`"App,PowerShell,FileSystem"`), and `ControlStatus` is always kept — upstream
offers no way to exclude it.

### Pin a local interpreter instead of `uvx`

`uvx` re-resolves the package on every launch. For a reproducible setup, install
it once (`uv tool install windows-mcp`) or use any Python that already has it,
and change `command`/`args` in the complete row above:

```yaml
- id: windows-mcp-bridge
  config:
    serverName: windows
    transport: stdio
    command: windows-mcp          # or C:\...\python.exe with args: [-m, windows_mcp, serve, ...]
    args: [serve, --exclude-tools, "App,PowerShell,FileSystem"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    env: { ANONYMIZED_TELEMETRY: "false", WINDOWS_MCP_DISABLE_FLASH: "1", WINDOWS_MCP_SCREENSHOT_SCALE: "0.75" }
```

### Use a long-lived HTTP server instead

Windows-MCP can also run as a background server. Upstream's `windows-mcp install`
registers an ONLOGON scheduled task that serves **streamable-http** on
`127.0.0.1:8000`; switch the row to match — this variant has `url` instead of
`command`/`args`/`env`:

```yaml
- id: windows-mcp-bridge
  config:
    serverName: windows
    transport: streamable-http
    url: http://127.0.0.1:8000/mcp/     # upstream prints this URL, trailing slash included
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
```

There is no `env` field in this variant, so the telemetry and flash defaults no
longer apply to the server: start it yourself with `ANONYMIZED_TELEMETRY=false`
and `WINDOWS_MCP_DISABLE_FLASH=1` if you want the same behaviour.

This survives DSH restarts and skips per-launch startup cost, at the price of a
process that outlives the app. Two upstream caveats: `install` binds the
scheduled task to the interpreter it was run from (installing from a temporary
`uvx` environment registers a task pointing at a cache directory that `uv` may
reclaim — install with `uv tool install windows-mcp` or a fixed venv instead),
and non-loopback hosts refuse to start without `--auth-key`/`--oauth-client-id`
or an explicit `--allow-insecure-remote`.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| No `mcp__windows__*` tools at all | Run `windows_mcp_doctor`. On a fresh install that is expected: the bridge ships disabled until you install the dependency from **Settings → Desktop** and restart DSH. If it is installed already, the doctor prints the effective row — look for `disabled` / `command` — and the host log carries `mcp-client(windows)` lines. |
| Tools disappeared after an upgrade | The tool names are `mcp__<serverName>__<tool>`. Changing `serverName` changes every tool name (and breaks the prompt cache prefix). |
| Screenshots come back as text | The active model does not accept image input, or attachments are disabled in your harness configuration. Upstream images are only projected when admission succeeds. |
| `App` tool fails or returns nothing | Upstream documents it as reliable on English Windows installs only; it is excluded by default. |
| DSH takes noticeably longer to boot | The bridge should not cost boot time: it ships `disabled: true` and only starts once an install has pointed it at an executable. A slow boot means some *other* row is resolving a toolchain at boot — check the effective row printed by `windows_mcp_doctor`. |
| Screenshot text is unreadable | Raise `WINDOWS_MCP_SCREENSHOT_SCALE` toward `1.0`; upstream caps captures at 1920×1080. |

## Security

This plugin hands the model your mouse, your keyboard, your clipboard, your
processes and your registry. Treat installing it as handing over control of the
desktop session it runs in.

What the design does and does not do:

- **No network exposure by default.** The default row is stdio: a child process
  connected by pipes, not a listening socket.
- **Secret hygiene on the child process.** The bridge starts MCP children from a
  scrubbed environment: variable names matching `KEY|PASSWORD|SECRET|TOKEN` and
  **all** `DSH_*` variables are removed before the configured `env` is merged in.
  Credentials should therefore be passed explicitly through the row's `env`, not
  inherited.
- **No telemetry from this plugin.** Upstream's own PostHog reporting is
  explicitly disabled in the shipped defaults.
- **Remote serving is upstream's problem, not a hidden default.** If you switch
  to HTTP, upstream enforces loopback host filtering and refuses to start on a
  non-loopback address without an auth key.
- **Switch flips are a window decision, not a network one.** Every mutating
  route (`/state`, `/prepare`, `/prepare/cancel`, `/bridge`, `/update`,
  `/settings`) requires the signed session cookie the DSH window receives during
  the launch-token exchange; without it the request is refused with `401`. A
  script, `curl`, or a model with shell access cannot turn desktop control on for
  itself. Reads stay open so pages can render before anything is decided.
- **When the cookie cannot be checked, the plugin says so.** A composition that
  mounts no `connection` service (headless hosts, Electron `file://`) cannot be
  authenticated; `/state` then reports `"gate": {"cookie": "unobservable"}`. In
  that case do not expose the web server on a non-loopback `--host`.
- **Files are still files.** The Computer Use flag in
  `$DSH_HOME/dsh-windows-mcp.state.json` and the machine-written patch block are
  ordinary files owned by the same user. An agent that can write them can still
  change the plugin's behaviour across a restart — the cookie gate closes the
  HTTP path, not filesystem trust. If that matters to you, run the desktop on a
  account the agent cannot write to, or do not grant shell access and desktop
  control to the same model.

## How it works

DeepSeek Harness plugins are loader patches, and a patch row may mount a package
that lives inside the Electron `app.asar` — the loader resolves official
`@deepseek-ai/*` names from the Desktop install anchor. Third-party code cannot
`import` those packages, but it *can* name them in a patch, because the mount
happens inside the loader rather than inside plugin code. That is the whole trick
behind this package:

```yaml
- insert:
    - id: windows-mcp-plugin
      name: dsh-windows-mcp                  # lib/index.js: doctor tool + startup audit
    - id: windows-mcp-bridge
      name: "@deepseek-ai/dsh-mcp-client"    # in-box bridge, configured for Windows-MCP
      disabled: true                          # inert until an install points it at an exe
      config: { transport: stdio, command: uvx, args: [windows-mcp@0.8.8, serve, ...] }
```

Consequences worth knowing:

- The integration is **version-sensitive** in one direction only: the bridge
  config schema belongs to DSH, not to this plugin. `package.json` declares the
  patch; DSH decides how to read it.
- Image projection is a bridge feature: MCP image blocks are saved as DSH
  attachments and surfaced as native image content. Audio and embedded resources
  degrade to diagnostic text.
- **MCP prompts are not supported** by the bridge (resources are, on demand).

## Development

```powershell
npm install
npm test          # node --test, including a real YAML parse of the patch
npm run check     # node --check lib/index.js
```

To see the composed config without touching a live profile — and without
restarting DSH — use the dump harness:

```powershell
# one-time: a scratch profile with the real profile's node_modules
mkdir  $env:USERPROFILE\.dsh\profiles\dtest
copy   $env:USERPROFILE\.dsh\profiles\desktop\package.json $env:USERPROFILE\.dsh\profiles\dtest\
cmd /c mklink /J $env:USERPROFILE\.dsh\profiles\dtest\node_modules $env:USERPROFILE\.dsh\profiles\desktop\node_modules

npm run dump
```

Layout:

```text
cordis.patch.yml      the integration: two insert rows
lib/index.js          host half: routes + windows_mcp_doctor + startup audit (no dependencies)
lib/dependency.js     dependency state, uv invocation, profile bridge-row writer
lib/pypi.js           PyPI index parsing and version maths (pure functions)
lib/mirrors.js        mirror candidates, ranged speed probe, ranking
lib/installs.js       per-version tool roots and the versions state file
lib/updater.js        version manager: check / install / activate / roll back
lib/settings.js       user settings: validation, storage, bridge round-trip
lib/client.js         web half: composer switch, plugin panel, settings page
test/plugin.test.mjs  patch composition + hostile-context + panel tests
test/update.test.mjs  version maths, mirror ranking, isolation and rollback state machine
test/settings.test.mjs  settings validation, bridge round-trip, settings route
scripts/dump-config.mjs  dev helper for composing against a scratch profile
tools/                zero-dependency debug probes (not published to npm)
```

To exercise the update path for real — real mirrors, real `uv`, real profile
write — use the e2e harness:

```powershell
node tools/update-e2e.mjs --check          # probe the mirrors, read the newest stable version
node tools/update-e2e.mjs --install 0.8.8  # download, activate, rewrite the bridge row
node tools/update-e2e.mjs --rollback
```

Contributions are welcome; keep `lib/index.js` free of runtime dependencies and
keep `apply()` throw-proof.

## Credits and license

MIT — see [LICENSE](LICENSE).

- [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) (MIT) does
  the actual desktop automation. This plugin only wires it up.
- The MCP client bridge is part of DeepSeek Harness and is not redistributed here.
- Not affiliated with DeepSeek or with the Windows-MCP authors.
