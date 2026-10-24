/**
 * dsh-windows-mcp — Windows-MCP version manager (host side).
 *
 * Responsibilities:
 *   - **Check**: probe the PyPI mirrors, pick the fastest one that works, read
 *     its `windows-mcp` index and report the newest stable release.
 *   - **Install**: install one version into its own tool root
 *     (`installs.js`) and activate it, rewriting the bridge row so the freshly
 *     installed executable is what the MCP client spawns. The previous version
 *     is kept, so a bad release is one click away from being rolled back.
 *   - **Rollback / activate**: switch the bridge to an already installed
 *     version — no download, no reinstall.
 *
 * The manager is deliberately synchronous-state/async-work, mirroring
 * `createPrepare`: the page polls a plain snapshot, actions are POSTs.
 */
import {
  WINDOWS_MCP_TOOL,
  dshHome,
  spawnUvInstall,
  toolVersionIn,
} from "./dependency.js";
import {
  activateVersion,
  activeInstall,
  executableIn,
  listManagedVersions,
  managedToolchainRoot,
  readVersionsState,
  toolDirectoryFor,
  versionToolRoot,
  writeManifest,
  writeVersionsState,
} from "./installs.js";
import { fetchProjectIndex, describeMirror, formatBytesPerSecond, mirrorOrder, probeMirrors } from "./mirrors.js";
import { latestStableVersion } from "./pypi.js";

/** Route the page posts update actions to. */
export const UPDATE_ROUTE = "/dsh-windows-mcp/update";

/** A check result older than this is refreshed when the page or host asks. */
export const CHECK_TTL_MS = 6 * 60 * 60 * 1000;

/** Install log kept in memory (the page renders the tail). */
const MAX_INSTALL_LOG_LINES = 60;
const MAX_LOG_LINE = 400;
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;

/** Actions accepted by the update route. */
export const UPDATE_ACTIONS = Object.freeze(["check", "install", "activate", "rollback"]);

/** Compact mirror results for the persisted check record / the page. */
function summarizeProbe(probe) {
  if (probe === null || probe === undefined) return { ranked: [], results: [] };
  const results = (Array.isArray(probe.results) ? probe.results : []).map((result) => ({
    id: result.id,
    label: result.label,
    ok: result.ok === true,
    speedBps: typeof result.speedBps === "number" ? result.speedBps : 0,
    indexMs: typeof result.indexMs === "number" ? result.indexMs : null,
    error: result.error ?? null,
  }));
  return { ranked: Array.isArray(probe.ranked) ? probe.ranked : [], results };
}

/**
 * Create the version manager.
 * @param options.home - DSH home (tests inject a temp directory).
 * @param options.warn - warning sink.
 * @param options.resolver - PATH lookup used to find `uv`.
 * @param options.pinned - upstream version pin from the bridge row.
 * @param options.writeBridge - `(executable) => bridge result`; rewrites the
 *   profile patch so the MCP client spawns the given executable.
 * @param options.probe - mirror probe implementation (tests inject one).
 * @param options.readIndex - project index reader (tests inject one).
 * @param options.spawnInstall - `uv tool install` starter (tests inject one).
 * @param options.now - clock (tests inject one).
 */
export function createUpdater(options = {}) {
  const home = options.home ?? dshHome();
  const warn = typeof options.warn === "function" ? options.warn : () => {};
  const resolver = typeof options.resolver === "function" ? options.resolver : () => null;
  const writeBridge = typeof options.writeBridge === "function" ? options.writeBridge : () => ({ ok: false, error: "bridge writer is not configured" });
  const probe = typeof options.probe === "function" ? options.probe : probeMirrors;
  const readIndex = typeof options.readIndex === "function" ? options.readIndex : fetchProjectIndex;
  const startInstall = typeof options.spawnInstall === "function" ? options.spawnInstall : spawnUvInstall;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const pinned = typeof options.pinned === "string" && options.pinned !== "" ? options.pinned : null;
  const root = managedToolchainRoot(home);

  const checkState = { phase: "idle", error: null, at: null, latest: null, best: null, mirrors: [] };
  const installState = {
    phase: "idle",
    version: null,
    mirror: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    log: [],
    bridge: null,
  };
  let lastProbe = null;
  let child = null;
  let timer = null;
  let checkPromise = null;
  let installPromise = null;

  const append = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/u)) {
      const trimmed = line.trimEnd();
      if (trimmed === "") continue;
      installState.log.push(trimmed.slice(0, MAX_LOG_LINE));
    }
    if (installState.log.length > MAX_INSTALL_LOG_LINES) installState.log.splice(0, installState.log.length - MAX_INSTALL_LOG_LINES);
  };

  const clearTimer = () => {
    if (timer !== null) {
      try {
        clearTimeout(timer);
      } catch {
        /* nothing to clear */
      }
      timer = null;
    }
  };

  const settleInstall = (phase, error) => {
    installState.phase = phase;
    installState.error = error ?? null;
    installState.finishedAt = new Date().toISOString();
    child = null;
    clearTimer();
    if (phase === "failed" && error !== null) warn(`Windows-MCP update failed: ${error}`);
  };

  const persistedCheck = () => {
    const state = readVersionsState(home);
    return state.lastCheck ?? null;
  };

  const isFresh = (record) => record !== null && Number.isFinite(Date.parse(record.at ?? "")) && now() - Date.parse(record.at) < CHECK_TTL_MS;

  /** Snapshot for the page: versions, check result, install progress. */
  function view() {
    const state = readVersionsState(home);
    const managed = listManagedVersions(root);
    const active = activeInstall(state, home);
    const persisted = state.lastCheck ?? null;
    const latest = checkState.phase === "ok" && typeof checkState.latest === "string" ? checkState.latest : persisted?.latest ?? null;
    const checkAt = checkState.phase === "ok" ? checkState.at : persisted?.at ?? null;
    const mirrors = Array.isArray(checkState.mirrors) ? checkState.mirrors : persisted?.mirrors ?? [];
    return {
      check: {
        phase: checkState.phase,
        at: checkAt,
        fresh: checkAt !== null && Number.isFinite(Date.parse(checkAt)) && now() - Date.parse(checkAt) < CHECK_TTL_MS,
        latest,
        best: checkState.phase === "ok" ? checkState.best ?? null : persisted?.best ?? null,
        error: checkState.error,
        mirrors,
      },
      install: {
        phase: installState.phase,
        version: installState.version,
        mirror: installState.mirror,
        startedAt: installState.startedAt,
        finishedAt: installState.finishedAt,
        error: installState.error,
        bridge: installState.bridge,
        log: installState.log.slice(-MAX_INSTALL_LOG_LINES),
      },
      versions: {
        pinned,
        active: state.active,
        previous: state.previous,
        history: state.history,
        available: managed.map((entry) => entry.version),
        installed: managed.map((entry) => ({
          version: entry.version,
          executable: entry.executable,
          installedAt: entry.installedAt,
          mirror: entry.mirror,
        })),
        toolchainRoot: root,
        activeExecutable: active?.executable ?? null,
        updateAvailable: latest !== null && state.active !== latest,
      },
    };
  }

  /** Probe mirrors, then read the newest stable version from the fastest one. */
  async function runCheck() {
    checkState.phase = "checking";
    checkState.error = null;
    let probeResult = null;
    try {
      probeResult = await probe({ project: WINDOWS_MCP_TOOL });
      lastProbe = probeResult;
    } catch (error) {
      checkState.phase = "failed";
      checkState.error = error instanceof Error ? error.message : String(error);
      return view();
    }
    const summarized = summarizeProbe(probeResult);
    let latest = null;
    let best = null;
    let lastError = "no mirror answered";
    for (const mirror of mirrorOrder(probeResult)) {
      try {
        const index = await readIndex({ indexUrl: mirror.indexUrl, project: WINDOWS_MCP_TOOL });
        latest = index.latest ?? latestStableVersion(index.versions ?? []);
        if (latest !== null) {
          best = mirror.id;
          break;
        }
        lastError = `${mirror.label} lists no stable windows-mcp version`;
      } catch (error) {
        lastError = `${mirror.label}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    checkState.at = new Date(now()).toISOString();
    if (latest === null) {
      checkState.phase = "failed";
      checkState.error = lastError;
    } else {
      checkState.phase = "ok";
      checkState.latest = latest;
      checkState.best = best;
      checkState.mirrors = summarized.results;
    }
    const state = readVersionsState(home);
    try {
      writeVersionsState(
        {
          ...state,
          lastCheck: {
            at: checkState.at,
            latest,
            best,
            mirrors: summarized.results,
          },
        },
        home,
      );
    } catch (error) {
      warn(`could not persist the Windows-MCP update check: ${String(error)}`);
    }
    return view();
  }

  /** Ensure a check result exists; `force` bypasses the TTL. */
  async function check(scope = {}) {
    const force = scope.force === true;
    if (checkPromise !== null) return checkPromise;
    const persisted = persistedCheck();
    if (!force && isFresh(persisted) && checkState.phase !== "failed") {
      checkState.phase = "ok";
      checkState.at = persisted.at;
      checkState.latest = persisted.latest;
      checkState.best = persisted.best;
      checkState.mirrors = Array.isArray(persisted.mirrors) ? persisted.mirrors : [];
      return view();
    }
    checkPromise = runCheck().finally(() => {
      checkPromise = null;
    });
    return checkPromise;
  }

  /** One `uv tool install` attempt from one mirror; resolves with the outcome. */
  function installAttempt({ uv, version, mirror }) {
    return new Promise((resolve) => {
      const toolRoot = versionToolRoot(root, version);
      const toolDirectory = toolDirectoryFor(root, version);
      const spec = `${WINDOWS_MCP_TOOL}@${version}`;
      append(`$ ${uv} tool install --force --default-index ${mirror.indexUrl} ${spec}  (UV_TOOL_DIR=${toolRoot})`);
      let running = null;
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        child = null;
        clearTimer();
        resolve(result);
      };
      try {
        const started = startInstall({
          uv,
          spec,
          indexUrl: mirror.indexUrl,
          toolDirectory: toolRoot,
          onLine: append,
        });
        running = started.child;
        child = running;
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      running.on("error", (error) => finish({ ok: false, error: String(error) }));
      running.on("close", (code) => {
        if (code !== 0) {
          finish({ ok: false, error: `uv exited with code ${code}` });
          return;
        }
        const installedVersion = toolVersionIn(toolDirectory);
        const executable = executableIn(toolDirectory);
        if (installedVersion !== version || executable === null) {
          finish({
            ok: false,
            error: `uv finished, but ${toolDirectory} does not contain windows-mcp ${version}`,
          });
          return;
        }
        finish({ ok: true, executable, toolDirectory });
      });
      timer = setTimeout(() => {
        append("install timed out after 30 minutes");
        try {
          running.kill();
        } catch {
          /* already gone */
        }
        finish({ ok: false, error: "install timed out" });
      }, INSTALL_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /** Rewrite the bridge to the given managed version and remember it. */
  function activate(version) {
    const executable = activeInstall({ active: version }, home)?.executable ?? null;
    if (executable === null) {
      return { ok: false, error: `Windows-MCP ${version} is not installed under ${root}` };
    }
    let bridge;
    try {
      bridge = writeBridge(executable);
    } catch (error) {
      bridge = { ok: false, error: String(error) };
    }
    if (bridge?.ok !== true) return { ok: false, error: bridge?.error ?? "the bridge row could not be written", bridge };
    const state = readVersionsState(home);
    const next = activateVersion(state, version);
    try {
      writeVersionsState(next, home);
    } catch (error) {
      return { ok: false, error: `the bridge was written, but the versions file could not be updated: ${String(error)}`, bridge };
    }
    installState.bridge = bridge;
    return { ok: true, version, executable, bridge };
  }

  /** Install `version` from the fastest mirror that works, then activate it. */
  async function installVersion(version) {
    if (typeof version !== "string" || version === "") return { ok: false, error: "a version is required" };
    if (installPromise !== null) return { ok: false, error: "an install is already running" };
    const uv = resolver("uv");
    if (uv === null) return { ok: false, error: "`uv` was not found on the PATH of this DSH process" };
    installPromise = (async () => {
      installState.phase = "installing";
      installState.version = version;
      installState.mirror = null;
      installState.startedAt = new Date().toISOString();
      installState.finishedAt = null;
      installState.error = null;
      installState.bridge = null;
      installState.log = [];
      if (lastProbe === null) {
        try {
          lastProbe = await probe({ project: WINDOWS_MCP_TOOL });
        } catch {
          lastProbe = null;
        }
      }
      const order = mirrorOrder(lastProbe);
      let lastError = "no mirror was available";
      for (const mirror of order) {
        installState.mirror = mirror.id;
        append(`trying ${mirror.label} (${formatBytesPerSecond(mirrorSpeed(lastProbe, mirror.id))})`);
        const attempt = await installAttempt({ uv, version, mirror });
        if (attempt.ok !== true) {
          lastError = `${mirror.label}: ${attempt.error}`;
          append(`failed: ${lastError}`);
          continue;
        }
        try {
          writeManifest(root, version, {
            executable: attempt.executable,
            toolDirectory: attempt.toolDirectory,
            indexUrl: mirror.indexUrl,
            mirror: mirror.id,
          });
        } catch (error) {
          warn(`could not write the Windows-MCP install manifest: ${String(error)}`);
        }
        const activated = activate(version);
        if (activated.ok !== true) {
          settleInstall("failed", activated.error ?? "activation failed");
          return { ok: false, error: installState.error, view: view() };
        }
        settleInstall("ok", null);
        return { ok: true, version, mirror: mirror.id, view: view() };
      }
      settleInstall("failed", lastError);
      return { ok: false, error: installState.error, view: view() };
    })().finally(() => {
      installPromise = null;
    });
    return installPromise;
  }

  /** Speed of one mirror from the last probe (0 when unknown). */
  function mirrorSpeed(probeResult, id) {
    const result = (probeResult?.results ?? []).find((entry) => entry.id === id);
    return typeof result?.speedBps === "number" ? result.speedBps : 0;
  }

  /** Switch to a version that is already installed (no download). */
  function activateInstalled(version) {
    if (installState.phase === "installing") return { ok: false, error: "an install is already running" };
    const activated = activate(version);
    return { ...activated, view: view() };
  }

  /** Go back to the version that the active one replaced. */
  function rollback() {
    const state = readVersionsState(home);
    if (state.previous === null) return { ok: false, error: "there is no previous version to go back to", view: view() };
    const target = state.previous;
    const activated = activate(target);
    return { ...activated, rolledBackFrom: state.active, view: view() };
  }

  /** Stop a running install. */
  function cancel() {
    if (installState.phase !== "installing") return { cancelled: false, state: view() };
    installState.phase = "cancelled";
    append("install cancelled by the user");
    if (child !== null) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      child = null;
    }
    clearTimer();
    installState.finishedAt = new Date().toISOString();
    return { cancelled: true, state: view() };
  }

  /**
   * Dependency view for `/state`: the existing snapshot shape, with managed
   * installs taking precedence over the global `uv tool` installation.
   */
  function dependencyView(legacy) {
    const state = readVersionsState(home);
    const active = activeInstall(state, home);
    const managed = listManagedVersions(root);
    const dependency = {
      ...legacy,
      managed: {
        toolchainRoot: root,
        active: state.active,
        previous: state.previous,
        available: managed.map((entry) => entry.version),
      },
    };
    if (active !== null) {
      dependency.installed = true;
      dependency.executable = active.executable;
      dependency.version = active.version;
      dependency.source = "managed";
    } else {
      dependency.source = "uv-tool";
    }
    return dependency;
  }

  return {
    view,
    check,
    installVersion,
    activateInstalled,
    rollback,
    cancel,
    dependencyView,
    describeMirror: (result) => describeMirror(result),
    /** Test seam: wait until no check/install is in flight. */
    async whenIdle() {
      await Promise.all([checkPromise, installPromise]);
    },
  };
}
