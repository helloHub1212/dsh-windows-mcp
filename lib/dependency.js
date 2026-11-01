/**
 * dsh-windows-mcp — dependency lifecycle (host side).
 *
 * Windows-MCP is a Python program. This module owns the three questions the
 * settings page asks about it:
 *
 *   1. **Is it here?** — `dependencySnapshot()` looks for the `uv` tool
 *      installation on disk (no subprocess per poll) and reads the version out
 *      of its `windows_mcp-<version>.dist-info`.
 *   2. **Install it** — `createPrepare()` runs `uv tool install` once, streams
 *      the output into a small ring buffer the page can show, and reports
 *      `idle | running | ok | failed | cancelled`.
 *   3. **Point the bridge at it** — a successful install rewrites the bridge row
 *      in the profile's own patch layer so the next DSH start launches the
 *      installed executable instead of racing `uvx` against a cold cache. The
 *      rewrite is delimited by markers, so it is idempotent and removable, and
 *      it backs the file up first.
 *
 * Zero dependencies: `node:*` plus the caller's `warn` sink. Everything that can
 * fail returns a description instead of throwing, because the callers are HTTP
 * handlers and a plugin boot path.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, basename, join, relative } from "node:path";

export const PACKAGE_ID = "dsh-windows-mcp";
export const BRIDGE_ROW_ID = "windows-mcp-bridge";
export const WINDOWS_MCP_TOOL = "windows-mcp";
export const STATE_ROUTE = "/dsh-windows-mcp/state";
export const PREPARE_ROUTE = "/dsh-windows-mcp/prepare";
export const PREPARE_CANCEL_ROUTE = "/dsh-windows-mcp/prepare/cancel";
export const BRIDGE_ROUTE = "/dsh-windows-mcp/bridge";

/** Markers around the machine-written block in the profile patch layer. */
export const PROFILE_BLOCK_BEGIN = "# >>> dsh-windows-mcp: bridge uses the installed Windows-MCP (machine written) >>>";
export const PROFILE_BLOCK_END = "# <<< dsh-windows-mcp <<<";

const PREPARE_LOG_LINES = 40;
const PREPARE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_LINE = 400;

/** The DSH home this process was started with. */
export function dshHome() {
  const fromEnvironment = String(process.env.DSH_HOME ?? "").trim();
  return fromEnvironment === "" ? join(homedir(), ".dsh") : fromEnvironment;
}

/** `uv tool` root: `$UV_TOOL_DIR`, else the platform default. */
export function uvToolRoot() {
  const fromEnvironment = String(process.env.UV_TOOL_DIR ?? "").trim();
  if (fromEnvironment !== "") return fromEnvironment;
  if (process.platform === "win32") {
    const appData = String(process.env.APPDATA ?? "").trim();
    return appData === "" ? join(homedir(), "AppData", "Roaming", "uv", "tools") : join(appData, "uv", "tools");
  }
  return join(homedir(), ".local", "share", "uv", "tools");
}

/** Directory `uv tool install windows-mcp` creates. */
export function windowsMcpToolDirectory() {
  return join(uvToolRoot(), WINDOWS_MCP_TOOL);
}

/** The installed console script, or null. Never throws. */
export function windowsMcpExecutable() {
  const directory = windowsMcpToolDirectory();
  const candidates =
    process.platform === "win32"
      ? [join(directory, "Scripts", `${WINDOWS_MCP_TOOL}.exe`), join(directory, "Scripts", WINDOWS_MCP_TOOL)]
      : [join(directory, "bin", WINDOWS_MCP_TOOL)];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Version of a `uv tool` installation, read from the dist-info directory inside
 * the tool's environment. Works for the global tool root and for the managed
 * per-version directories this plugin keeps (see `installs.js`).
 * @param toolDirectory - the directory that contains `Scripts/` and `Lib/`,
 *   i.e. `…/tools/windows-mcp` or `…/tools/<version>/windows-mcp`.
 */
export function toolVersionIn(toolDirectory) {
  if (typeof toolDirectory !== "string" || toolDirectory === "") return null;
  const packages = [];
  const collect = (sitePackages) => {
    try {
      for (const entry of readdirSync(sitePackages, { withFileTypes: true })) {
        if (entry.isDirectory()) packages.push(entry.name);
      }
    } catch {
      /* layout absent */
    }
  };
  collect(join(toolDirectory, "Lib", "site-packages"));
  try {
    for (const entry of readdirSync(join(toolDirectory, "lib"), { withFileTypes: true })) {
      if (entry.isDirectory() && /^python\d/u.test(entry.name)) collect(join(toolDirectory, "lib", entry.name, "site-packages"));
    }
  } catch {
    /* POSIX layout absent */
  }
  for (const name of packages) {
    const match = /^windows_mcp-(.+)\.dist-info$/u.exec(name);
    if (match) return match[1];
  }
  return null;
}

/** Version of the globally installed tool, read from its dist-info directory. */
export function windowsMcpVersion(executable = windowsMcpExecutable()) {
  if (executable === null) return null;
  return toolVersionIn(windowsMcpToolDirectory());
}

/** The pinned upstream version our patch mounts, e.g. `0.8.8`, or null. */
export function windowsMcpVersionPin(patchText) {
  // Stop at anything that ends a version in YAML or prose: whitespace, quotes,
  // commas, closing brackets, and the backtick/paren used in comments.
  const match = /windows-mcp@([0-9][^\s,'"\]`);]*)/u.exec(String(patchText ?? ""));
  return match === null ? null : match[1];
}

/**
 * What the page needs to know about the dependency.
 * @param resolver - `(name) => path|null`, the caller's PATH lookup.
 * @param pinned - upstream pin to install, or null to float.
 * @param env - environment used to work out which profile a manual write would touch.
 */
export function dependencySnapshot(resolver, pinned, env = process.env) {
  const executable = windowsMcpExecutable();
  const picked = preferredProfileDirectory(dshHome(), env);
  return {
    uv: typeof resolver === "function" ? resolver("uv") : null,
    uvx: typeof resolver === "function" ? resolver("uvx") : null,
    toolRoot: uvToolRoot(),
    installed: executable !== null,
    executable,
    version: windowsMcpVersion(executable),
    pinned: pinned ?? null,
    /** Which profile's patch layer a manual write or the installer would update. */
    profile: { target: picked.directory, source: picked.source, candidates: picked.candidates.length },
    /** Rough download the page shows before the user commits, in bytes. */
    estimatedDownloadBytes: 60 * 1024 * 1024,
  };
}

/* ------------------------------------------------------------------ *
 * install
 * ------------------------------------------------------------------ */

/**
 * Environment for `uv tool install`.
 *
 * `UV_CONCURRENT_DOWNLOADS` is deliberately below uv's default of 8: the
 * mainland mirrors rate-limit aggressive parallelism (measured: USTC answered
 * HTTP 429 while unzipping a dependency when uv fetched 8 files at once), and a
 * slow-but-successful install beats a fast-but-failing one.
 *
 * @param toolDirectory - when set, the install is redirected into that tool
 *   root (`UV_TOOL_DIR`) instead of the global one, which is how this plugin
 *   keeps several upstream versions side by side.
 */
export function uvInstallEnvironment(toolDirectory = null) {
  const environment = {
    ...process.env,
    UV_HTTP_TIMEOUT: "600",
    UV_CONCURRENT_DOWNLOADS: "4",
    UV_HTTP_RETRIES: "3",
  };
  if (typeof toolDirectory === "string" && toolDirectory !== "") environment.UV_TOOL_DIR = toolDirectory;
  return environment;
}

/**
 * Start one `uv tool install` and stream its output to `onLine`.
 * @returns `{ child, args }` — the caller owns the child's lifecycle.
 */
export function spawnUvInstall(options = {}) {
  const uv = options.uv;
  const spec = options.spec;
  const indexUrl = typeof options.indexUrl === "string" && options.indexUrl !== "" ? options.indexUrl : null;
  const toolDirectory = typeof options.toolDirectory === "string" && options.toolDirectory !== "" ? options.toolDirectory : null;
  const onLine = typeof options.onLine === "function" ? options.onLine : () => {};
  const args = ["tool", "install", "--force"];
  if (indexUrl !== null) args.push("--default-index", indexUrl);
  args.push(spec);
  const child = spawn(uv, args, {
    cwd: typeof options.cwd === "string" ? options.cwd : homedir(),
    env: { ...uvInstallEnvironment(toolDirectory), ...(options.env ?? {}) },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
  } catch {
    /* a child without pipes still closes */
  }
  return { child, args };
}

/**
 * One `uv tool install` at a time, with a bounded log the page can follow.
 * @param options.warn - warning sink.
 * @param options.resolver - PATH lookup used to find `uv`.
 * @param options.pinned - upstream version pin.
 * @param options.indexUrl - PyPI index to install from (a mirror), or null.
 * @param options.toolDirectory - `UV_TOOL_DIR` for an isolated install, or null
 *   for the global tool root.
 * @param options.resolveExecutable - where to look for the installed executable
 *   afterwards; defaults to the global `uv tool` installation.
 * @param options.afterInstall - called with the installed executable, returns
 *   the bridge-write outcome that `snapshot()` then reports.
 */
export function createPrepare(options = {}) {
  const warn = typeof options.warn === "function" ? options.warn : () => {};
  const resolver = typeof options.resolver === "function" ? options.resolver : () => null;
  const afterInstall = typeof options.afterInstall === "function" ? options.afterInstall : () => null;

  const state = {
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    error: null,
    log: [],
    bridge: null,
  };
  let child = null;
  let timer = null;

  const append = (chunk) => {
    for (const line of String(chunk).replace(/\r/gu, "").split("\n")) {
      const trimmed = line.trimEnd();
      if (trimmed === "") continue;
      state.log.push(trimmed.slice(0, MAX_LOG_LINE));
    }
    if (state.log.length > PREPARE_LOG_LINES) state.log.splice(0, state.log.length - PREPARE_LOG_LINES);
  };

  const settle = (phase, error) => {
    state.phase = phase;
    state.error = error ?? null;
    state.finishedAt = new Date().toISOString();
    child = null;
    if (timer !== null) {
      try {
        clearTimeout(timer);
      } catch {
        /* nothing to clear */
      }
      timer = null;
    }
    if (phase === "failed" && error !== null) warn(`Windows-MCP install failed: ${error}`);
  };

  return {
    /** Start (or refuse to double-start) the install. */
    start() {
      if (state.phase === "running") return { started: false, reason: "an install is already running", state: this.snapshot() };
      const uv = resolver("uv");
      if (uv === null) {
        settle("failed", "`uv` was not found on the PATH of this DSH process. Install uv (https://docs.astral.sh/uv/) and restart DSH, then retry.");
        return { started: false, reason: state.error, state: this.snapshot() };
      }
      const spec = options.pinned === null || options.pinned === undefined ? WINDOWS_MCP_TOOL : `${WINDOWS_MCP_TOOL}@${options.pinned}`;
      const indexUrl = typeof options.indexUrl === "string" && options.indexUrl !== "" ? options.indexUrl : null;
      const toolDirectory = typeof options.toolDirectory === "string" && options.toolDirectory !== "" ? options.toolDirectory : null;
      const resolveExecutable = typeof options.resolveExecutable === "function" ? options.resolveExecutable : windowsMcpExecutable;
      state.phase = "running";
      state.startedAt = new Date().toISOString();
      state.finishedAt = null;
      state.error = null;
      state.bridge = null;
      const command = [uv, "tool", "install", "--force", ...(indexUrl === null ? [] : ["--default-index", indexUrl]), spec].join(" ");
      state.log = [`$ ${command}${toolDirectory === null ? "" : `  (UV_TOOL_DIR=${toolDirectory})`}`];
      try {
        const { child: running } = spawnUvInstall({ uv, spec, indexUrl, toolDirectory, onLine: append });
        child = running;
        running.on("error", (error) => settle("failed", String(error)));
        running.on("close", (code) => {
          if (state.phase === "cancelled") return;
          if (code !== 0) {
            settle("failed", `uv exited with code ${code}`);
            return;
          }
          const executable = resolveExecutable();
          if (executable === null) {
            settle("failed", "uv reported success, but no windows-mcp executable appeared in the tool directory.");
            return;
          }
          try {
            state.bridge = afterInstall(executable);
          } catch (error) {
            state.bridge = { ok: false, error: String(error) };
          }
          settle("ok", null);
        });
        timer = setTimeout(() => {
          append("install timed out after 30 minutes");
          this.cancel();
        }, PREPARE_TIMEOUT_MS);
        if (typeof timer.unref === "function") timer.unref();
        return { started: true, spec, state: this.snapshot() };
      } catch (error) {
        settle("failed", String(error));
        return { started: false, reason: state.error, state: this.snapshot() };
      }
    },

    /** Stop a running install. */
    cancel() {
      if (state.phase !== "running" || child === null) return false;
      const running = child;
      child = null;
      try {
        running.kill();
      } catch {
        /* already gone */
      }
      settle("cancelled", "cancelled before it finished");
      return true;
    },

    /** Safe-to-serialise view for the page. */
    snapshot() {
      return {
        phase: state.phase,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        error: state.error,
        log: state.log.slice(-PREPARE_LOG_LINES),
        bridge: state.bridge,
      };
    },

    /** Test seam: stop the clock without a child. */
    __settle: settle,
  };
}

/* ------------------------------------------------------------------ *
 * profile patch rewrite
 * ------------------------------------------------------------------ */

/** Single-quoted YAML scalar: backslashes stay literal, `'` doubles. */
export function yamlScalar(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

/**
 * The bridge row values this package ships. The settings page may change them;
 * `lib/settings.js` normalises user input against these same defaults.
 */
export const BRIDGE_DEFAULTS = Object.freeze({
  toolCallTimeoutMs: 120000,
  excludeTools: Object.freeze(["App", "PowerShell", "FileSystem"]),
  screenshotScale: 0.75,
  screenshotBackend: "auto",
  disableFlash: true,
});

/** Render `args:` — `--exclude-tools` takes one comma-separated argv. */
function bridgeArgsLine(excludeTools) {
  const names = Array.from(excludeTools, (name) => String(name).trim()).filter((name) => name !== "");
  if (names.length === 0) return "    args: [serve]";
  return `    args: [serve, --exclude-tools, ${JSON.stringify(names.join(","))}]`;
}

/** Render `env:` — only the keys that are set, in a stable order. */
function bridgeEnvLine(settings) {
  const pairs = ['ANONYMIZED_TELEMETRY: "false"'];
  if (settings.disableFlash !== false) pairs.push('WINDOWS_MCP_DISABLE_FLASH: "1"');
  pairs.push(`WINDOWS_MCP_SCREENSHOT_SCALE: ${JSON.stringify(String(settings.screenshotScale))}`);
  if (typeof settings.screenshotBackend === "string" && settings.screenshotBackend !== "auto") {
    pairs.push(`WINDOWS_MCP_SCREENSHOT_BACKEND: ${JSON.stringify(settings.screenshotBackend)}`);
  }
  return `    env: { ${pairs.join(", ")} }`;
}

/** Fold user settings (or their absence) into one complete bridge value set. */
function bridgeValues(meta) {
  const source = meta.settings !== null && typeof meta.settings === "object" ? meta.settings : null;
  const merged = { ...BRIDGE_DEFAULTS };
  if (source === null) return merged;
  if (typeof source.toolCallTimeoutMs === "number" && Number.isFinite(source.toolCallTimeoutMs)) {
    merged.toolCallTimeoutMs = Math.round(source.toolCallTimeoutMs);
  }
  if (Array.isArray(source.excludeTools)) merged.excludeTools = source.excludeTools.slice();
  if (typeof source.screenshotScale === "number" && Number.isFinite(source.screenshotScale)) {
    merged.screenshotScale = source.screenshotScale;
  }
  if (typeof source.screenshotBackend === "string" && source.screenshotBackend !== "") {
    merged.screenshotBackend = source.screenshotBackend;
  }
  if (typeof source.disableFlash === "boolean") merged.disableFlash = source.disableFlash;
  return merged;
}

/**
 * The complete bridge row, pointing at an installed executable.
 * `meta.settings` is the optional `bridge` half of the user settings.
 */
export function bridgeOverrideBlock(executable, meta = {}) {
  const stamp = typeof meta.stamp === "string" ? meta.stamp : new Date().toISOString();
  const version = typeof meta.version === "string" ? meta.version : "unknown";
  const values = bridgeValues(meta);
  return [
    PROFILE_BLOCK_BEGIN,
    `# Written by ${PACKAGE_ID} ${version} at ${stamp}.`,
    "# A patch replaces the whole `config`, so the complete row is restated here.",
    `- id: ${BRIDGE_ROW_ID}`,
    // Re-enable the row the bundle patch ships inert. Without this the
    // machine block would override `config` while `disabled: true` stayed in
    // effect, and the profile would boot with no Windows tools at all.
    "  disabled: false",
    "  config:",
    "    serverName: windows",
    "    transport: stdio",
    `    command: ${yamlScalar(executable)}`,
    bridgeArgsLine(values.excludeTools),
    `    toolCallTimeoutMs: ${values.toolCallTimeoutMs}`,
    "    failOnStartupError: false",
    "    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }",
    bridgeEnvLine(values),
    PROFILE_BLOCK_END,
  ].join("\n");
}

/** Drop any previous machine-written block, then append the fresh one. */
export function withBridgeOverride(text, block, eol = "\n") {
  const kept = [];
  let skipping = false;
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    if (line.includes(PROFILE_BLOCK_BEGIN)) {
      skipping = true;
      continue;
    }
    if (line.includes(PROFILE_BLOCK_END)) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  const head = kept.length === 0 ? "# Your patch layer for this dsh profile." : kept.join(eol);
  const body = block.split("\n").join(eol);
  return `${head}${eol}${eol}${body}${eol}`;
}

/** `--profile <name>` / `--profile=<name>` from the launcher's own argv. */
export function profileFromArgv(argv = process.argv) {
  const list = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (typeof token !== "string") continue;
    if (token === "--profile" && typeof list[index + 1] === "string") return list[index + 1].trim();
    if (token.startsWith("--profile=")) return token.slice("--profile=".length).trim();
  }
  return null;
}

/** Explicit escape hatch: a profile name or an absolute profile directory. */
export const PROFILE_ENV = "DSH_WINDOWS_MCP_PROFILE";

/**
 * The profile this host booted: an explicit `DSH_WINDOWS_MCP_PROFILE` (name or
 * absolute directory), else `DSH_PROFILE_DIR`, else `DSH_PROFILE`, else the
 * launcher's own `--profile` argument. `null` when the host tells us nothing —
 * the caller must then not guess between several installed profiles.
 */
export function currentProfileDirectory(env = process.env, argv = process.argv) {
  const explicit = String(env?.DSH_WINDOWS_MCP_PROFILE ?? "").trim();
  if (explicit !== "") return isAbsolute(explicit) ? explicit : join(dshHome(), "profiles", explicit);
  const directory = String(env?.DSH_PROFILE_DIR ?? "").trim();
  if (directory !== "") return directory;
  const name = String(env?.DSH_PROFILE ?? "").trim() || profileFromArgv(argv);
  if (name === null || name === "") return workingDirectory();
  return join(dshHome(), "profiles", name);
}

/**
 * Last resort: the harness runs the app from inside the profile (a pnpm
 * workspace), so a `node_modules/dsh-windows-mcp` next to the working directory
 * is that profile. Only a hint — the caller re-checks it against `home`.
 */
function workingDirectory() {
  try {
    const cwd = String(process.cwd());
    return cwd !== "" && existsSync(join(cwd, "node_modules", PACKAGE_ID)) ? cwd : null;
  } catch {
    return null;
  }
}

/** Profiles under this DSH home that have the package installed. */
export function profileDirectories(home = dshHome()) {
  const profilesRoot = join(home, "profiles");
  const found = [];
  try {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(profilesRoot, entry.name);
      if (existsSync(join(directory, "node_modules", PACKAGE_ID))) found.push(directory);
    }
  } catch {
    /* no profiles directory */
  }
  return found;
}

/** Is `directory` one of this home's profiles? Keeps the `home` argument authoritative. */
const withinProfiles = (directory, home) => {
  const rest = relative(join(home, "profiles"), directory);
  return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
};

/**
 * Which profile's patch layer a manual install or the installer should update:
 * the profile this host booted when we can tell, the only candidate, or nothing
 * at all when the package sits in several profiles and the host reports none —
 * guessing there would silently edit the wrong profile.
 * @returns `{ directory, source: "booted"|"only"|"none"|"ambiguous", candidates }`.
 */
export function preferredProfileDirectory(home = dshHome(), env = process.env, argv = process.argv) {
  const candidates = profileDirectories(home);
  const requested = currentProfileDirectory(env, argv);
  if (requested !== null && withinProfiles(requested, home) && existsSync(join(requested, "node_modules", PACKAGE_ID))) {
    return { directory: requested, source: "booted", candidates };
  }
  if (candidates.length === 0) return { directory: null, source: "none", candidates };
  if (candidates.length === 1) return { directory: candidates[0], source: "only", candidates };
  return { directory: null, source: "ambiguous", candidates };
}

/**
 * Point the bridge row at an installed executable.
 * @returns `{ ok, path, backup, executable, restartRequired }` or `{ ok:false, error }`.
 */
export function writeBridgeOverride(executable, options = {}) {
  const warn = typeof options.warn === "function" ? options.warn : () => {};
  const home = typeof options.home === "string" ? options.home : dshHome();
  const env = options.env ?? process.env;
  const version = typeof options.version === "string" ? options.version : "unknown";
  try {
    if (typeof executable !== "string" || executable === "" || !existsSync(executable)) {
      return { ok: false, error: "the installed Windows-MCP executable was not found", path: null };
    }
    const picked = preferredProfileDirectory(home, env);
    if (picked.directory === null) {
      if (picked.source === "ambiguous") {
        const names = picked.candidates.map((entry) => basename(entry)).join(", ");
        return {
          ok: false,
          path: null,
          error: `${PACKAGE_ID} is installed in ${picked.candidates.length} profiles (${names}) and this host does not report which one it booted, so no patch layer was touched — set ${PROFILE_ENV}=<profile name> and retry`,
        };
      }
      return {
        ok: false,
        error: `no profile under ${join(home, "profiles")} has ${PACKAGE_ID} installed, so there is no patch layer to update`,
        path: null,
      };
    }
    const directory = picked.directory;
    const file = join(directory, "cordis.patch.yml");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const eol = current.includes("\r\n") ? "\r\n" : "\n";
    let backup = null;
    if (current !== "") {
      backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
      try {
        copyFileSync(file, backup);
      } catch (error) {
        warn(`could not back up ${file}: ${String(error)}`);
        backup = null;
      }
    }
    writeFileSync(
      file,
      withBridgeOverride(
        current,
        bridgeOverrideBlock(executable, { stamp: new Date().toISOString(), version, settings: options.settings }),
        eol,
      ),
      "utf8",
    );
    return { ok: true, path: file, backup, executable, restartRequired: true };
  } catch (error) {
    warn(`could not point the bridge at the installed Windows-MCP: ${String(error)}`);
    return { ok: false, error: String(error), path: null };
  }
}
