/**
 * dsh-windows-mcp — 宿主半边 / host half.
 *
 * What this file is for
 * ---------------------
 * The actual integration is declarative: `cordis.patch.yml` mounts the official
 * in-box MCP client bridge (`@deepseek-ai/dsh-mcp-client`) against
 * CursorTouch/Windows-MCP. Everything the model can *do* therefore comes from
 * that bridge — this package ships no tools of its own but ONE diagnostic tool,
 * `windows_mcp_doctor`, which answers the only question a carrier bundle can
 * usefully answer: "why are the `mcp__windows__*` tools missing or failing?"
 *
 * Disciplines (same three every healthy DSH plugin follows)
 * --------------------------------------------------------
 *   1. `apply()` never throws — a synchronous throw fails this loader entry's
 *      fiber and the boot audit reports "Failed to load plugins".
 *   2. Only inject services that are certainly provided. Here: `tools`, which
 *      every profile has. Injecting a service nobody provides leaves the fiber
 *      PENDING and drags the whole plugin tree.
 *   3. No log noise. A working plugin logs nothing; anything worth logging is
 *      logged once, at warn level, together with what to do about it.
 *
 * Zero runtime dependencies: this module only uses `node:*` builtins, because
 * third-party DSH plugins cannot import `@deepseek-ai/*` (everything official
 * lives inside `app.asar`).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRIDGE_ROUTE,
  PREPARE_CANCEL_ROUTE,
  PREPARE_ROUTE,
  dependencySnapshot,
  windowsMcpExecutable,
  windowsMcpVersionPin,
  writeBridgeOverride,
} from "./dependency.js";
import { UPDATE_ACTIONS, UPDATE_ROUTE, createUpdater } from "./updater.js";
import {
  SETTINGS_ROUTE,
  bridgeSettingsMatch,
  bridgeSettingsOf,
  normalizeSettings,
  readBridgeSettings,
  readSettings,
  writeSettings,
} from "./settings.js";

const PACKAGE_ID = "dsh-windows-mcp";
const BRIDGE_ROW_ID = "windows-mcp-bridge";
const TOOL_NAME = "windows_mcp_doctor";
/** Every bridged tool is `mcp__<serverName>__<UpstreamToolName>`. */
const BRIDGE_TOOL_PREFIX = "mcp__windows__";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const patchPath = join(packageRoot, "cordis.patch.yml");
const windowsMcpHome = join(homedir(), ".windows-mcp");

/**
 * The Computer Use flag the client pill reads and writes. It is host-owned and
 * persisted next to the DSH home, so the switch survives a restart; the client
 * only ever renders what this route answers.
 */
const stateDirectory = (() => {
  const fromEnvironment = String(process.env.DSH_HOME ?? "").trim();
  return fromEnvironment === "" ? join(homedir(), ".dsh") : fromEnvironment;
})();
const statePath = join(stateDirectory, "dsh-windows-mcp.state.json");
const STATE_ROUTE = "/dsh-windows-mcp/state";
const MAX_STATE_BODY_BYTES = 1024;
const MAX_SETTINGS_BODY_BYTES = 8192;

/** Mirrors the persisted flag; read once at boot, updated by the state route.
 *  Desktop control is opt-in: a fresh install starts OFF. */
const computerUse = { enabled: false };

/** User settings; read once at boot, replaced by the settings route. */
let settings = null;

/** The Windows-MCP version manager, created in apply() once the logger exists. */
let updater = null;

/* ------------------------------------------------------------------ *
 * small, throw-proof helpers
 * ------------------------------------------------------------------ */

/** Read a UTF-8 file, or null. Never throws. */
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Parse JSON from a file, or null. Never throws. */
function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** This package's declared version, or "unknown". */
function selfVersion() {
  const manifest = readJson(join(packageRoot, "package.json"));
  return typeof manifest?.version === "string" ? manifest.version : "unknown";
}

/** PATH entries (de-quoted) plus the `uv tool` shim directory. */
function searchDirectories() {
  const entries = String(process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/gu, "").trim())
    .filter(Boolean);
  // `uv tool install` and `uvx` both publish shims here, and a GUI-launched
  // DSH does not always have it on PATH.
  entries.unshift(join(homedir(), ".local", "bin"));
  return entries;
}

/** Executable suffixes to try on this platform. */
function executableSuffixes() {
  if (process.platform !== "win32") return [""];
  const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return raw
    .split(";")
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve an executable the way a shell would (PATH + PATHEXT).
 * @returns Absolute path, or null when nothing matches.
 */
function which(name) {
  const suffixes = executableSuffixes();
  for (const directory of searchDirectories()) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** `stat` summary for a path, or null. */
function describeFile(path) {
  try {
    if (!existsSync(path)) return null;
    const info = statSync(path);
    return { path, bytes: info.size, modified: info.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** The `windows-mcp-bridge` block of our patch file, verbatim. */
function bridgeBlock() {
  const text = readText(patchPath);
  if (text === null) return null;
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes(BRIDGE_ROW_ID));
  if (start < 0) return null;
  const block = [];
  for (let index = start; index < lines.length && block.length < 60; index += 1) {
    const line = lines[index];
    const indent = line.search(/\S/u);
    if (index > start && indent >= 0 && indent <= 4 && /^\s*-\s+(?:id|insert):/u.test(line)) break;
    block.push(line);
  }
  return block.join("\n").trimEnd();
}

/**
 * Names of registered tools, when the tool runtime exposes them.
 * The listing API is host-owned and may change: every shape is probed inside
 * try/catch and a miss simply omits this section from the report.
 * @returns `{ total, bridged }` or null.
 */
function toolInventory(tools) {
  try {
    if (typeof tools?.schemas !== "function") return null;
    const schemas = tools.schemas();
    if (!Array.isArray(schemas)) return null;
    const names = schemas
      .map((entry) => (Array.isArray(entry) ? entry[0] : entry?.name))
      .filter((name) => typeof name === "string");
    return { total: names.length, bridged: names.filter(isBridgedToolName).sort() };
  } catch {
    return null;
  }
}

/** Read the persisted Computer Use flag; default OFF when nothing is stored. */
function readComputerUse() {
  const raw = readText(statePath);
  if (raw === null) return { enabled: false };
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/u, ""));
    return { enabled: parsed?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

/** Persist the flag. A read-only home is not an error: the switch stays live
 *  for this process and simply does not survive a restart. */
function persistComputerUse(enabled) {
  try {
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify({ enabled: enabled === true, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/** How many bridged desktop tools this scope can currently see, or null. */
function bridgedToolCount(tools) {
  const inventory = toolInventory(tools);
  return inventory === null ? null : inventory.bridged.length;
}

/** True for a tool this package's bridge is responsible for. */
function isBridgedToolName(name) {
  return typeof name === "string" && name.startsWith(BRIDGE_TOOL_PREFIX);
}

/**
 * Enforce the Computer Use switch, with two mechanisms that fail differently:
 *
 *   1. `system-prompt/assemble` is authoritative for the model-facing tool list,
 *      so filtering there means a switched-off desktop is simply not offered.
 *   2. `tools.guard()` is a synchronous global veto inside dispatch, so a model
 *      that remembers the names from history still cannot execute them.
 *
 * `tools.restrict()` is deliberately NOT used: it requires a scoped context
 * (`agent.ctx`) and throws for names that are not registered yet, which is the
 * normal state while the bridge is still connecting. A plain-context guard and
 * the per-step waterfall both apply to every agent, so one switch covers every
 * session, subagent and teammate, and flipping it needs no restart.
 */
function registerToolGate(ctx, warn) {
  if (typeof ctx?.on === "function") {
    try {
      ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
        const assembly = await next();
        if (computerUse.enabled || assembly === null || typeof assembly !== "object") return assembly;
        const tools = assembly.tools;
        if (!Array.isArray(tools)) return assembly;
        const kept = tools.filter((tool) => !isBridgedToolName(tool?.name));
        if (kept.length === tools.length) return assembly;
        // Copy rather than mutate: the incoming assembly may be shared, and the
        // copy keeps whatever prototype the host built it with.
        return Object.assign(Object.create(Object.getPrototypeOf(assembly)), assembly, { tools: kept });
      });
    } catch (error) {
      warn(`could not hook prompt assembly, so desktop tools stay visible: ${String(error)}`);
    }
  }

  if (typeof ctx?.inject !== "function") return;
  try {
    ctx.inject(["tools"], (scoped) => {
      try {
        if (typeof scoped?.tools?.guard !== "function") return;
        scoped.tools.guard((execution) => {
          if (computerUse.enabled) return undefined;
          if (!isBridgedToolName(execution?.name)) return undefined;
          return `Computer Use is switched off, so "${execution.name}" is not available. Switch the Computer Use control back on in the composer and retry.`;
        });
      } catch (error) {
        warn(`could not install the Computer Use dispatch guard: ${String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject the tools service for the dispatch guard: ${String(error)}`);
  }
}

/* ------------------------------------------------------------------ *
 * diagnostics
 * ------------------------------------------------------------------ */

/**
 * Build the human-readable doctor report.
 * @param tools - the `tools` service, or undefined.
 */
function buildReport(tools) {
  const lines = [];
  const advice = [];

  const uv = which("uv");
  const uvx = which("uvx");
  const python = which("python") ?? which("py");
  const manifest = readJson(join(packageRoot, "package.json"));

  lines.push(`dsh-windows-mcp ${selfVersion()} — Windows-MCP bridge diagnostics`);
  lines.push(`host           : node ${process.version} / ${process.platform} ${process.arch}`);
  lines.push(`uv             : ${uv ?? "NOT FOUND"}`);
  lines.push(`uvx            : ${uvx ?? "NOT FOUND"}`);
  lines.push(`python         : ${python ?? "not on PATH"}`);
  const dependency = dependencySnapshot(which, windowsMcpVersionPin(readText(patchPath)));
  lines.push(
    `windows-mcp    : ${
      dependency.installed
        ? `${dependency.version ?? "version unknown"} — ${dependency.executable}`
        : "not installed through `uv tool` (install it from Settings → Plugins → this bundle, or run `uv tool install windows-mcp`)"
    }`,
  );

  const update = updater === null ? null : updater.view();
  if (update !== null) {
    const managed = update.versions;
    lines.push(
      `managed install : ${
        managed.active === null
          ? "none yet — the global `uv tool` installation is used (installing or updating creates one)"
          : `v${managed.active} under ${managed.toolchainRoot}`
      }`,
    );
    if (managed.previous !== null) lines.push(`  rollback to  : v${managed.previous}`);
    if (managed.available.length > 0) lines.push(`  installed    : ${managed.available.map((version) => `v${version}`).join(", ")}`);
    if (update.check.latest === null) {
      lines.push("  latest       : not checked yet — press Check for updates in Settings → Plugins");
    } else {
      lines.push(`  latest       : v${update.check.latest}${managed.updateAvailable ? " — an update is available" : " — up to date"}`);
    }
  }

  if (uv === null && uvx === null) {
    advice.push(
      "Install uv (https://docs.astral.sh/uv/) and make sure it is on the PATH of the process that runs DSH — the Settings → Desktop page needs it to install Windows-MCP. Booting DSH does not need it.",
    );
  }

  const configFile = describeFile(join(windowsMcpHome, "config.toml"));
  const serverLog = describeFile(join(windowsMcpHome, "server.log"));
  const startScript = describeFile(join(windowsMcpHome, "start-server.cmd"));
  lines.push(`~/.windows-mcp : ${existsSync(windowsMcpHome) ? "present" : "absent"}`);
  lines.push(`  config.toml  : ${configFile === null ? "absent" : `${configFile.bytes} B, ${configFile.modified}`}`);
  lines.push(`  server.log   : ${serverLog === null ? "absent" : `${serverLog.bytes} B, ${serverLog.modified}`}`);
  lines.push(`  start-server : ${startScript === null ? "absent" : startScript.path}`);
  if (startScript !== null) {
    lines.push(
      "  note         : a scheduled-task install exists; it serves streamable-http on 127.0.0.1:8000, while this plugin's default row uses stdio.",
    );
  }

  lines.push(
    `computer use   : ${computerUse.enabled ? "ON — the bridged desktop tools are offered and callable" : `OFF — every ${BRIDGE_TOOL_PREFIX}* tool is hidden from the model and denied at dispatch`}`,
  );
  lines.push(`  state file   : ${statePath}`);
  if (!computerUse.enabled) {
    lines.push(
      "  hint         : switch it on with the Computer Use control in the composer (top-left of the input row) to give the agent this desktop.",
    );
  }

  const inventory = toolInventory(tools);
  if (inventory !== null) {
    lines.push(`tools          : ${inventory.total} registered, ${inventory.bridged.length} bridged`);
    lines.push(
      `  bridged      : ${inventory.bridged.length === 0 ? "NONE — the bridge did not register any windows tool" : inventory.bridged.join(", ")}`,
    );
    if (inventory.bridged.length === 0) {
      advice.push(
        "No `mcp__windows__*` tool is registered. The bridge row ships disabled so DSH can boot on any network; install the dependency from Settings → Desktop, then restart DSH. If it is installed already, check the effective row below for `disabled`/`command` and the host log for `mcp-client(windows)` lines.",
      );
    }
  } else {
    lines.push("tools          : (tool runtime did not expose a listing)");
  }

  const block = bridgeBlock();
  lines.push("");
  lines.push(`effective rows from ${patchPath}:`);
  lines.push(block === null ? "  (cordis.patch.yml missing or has no windows-mcp-bridge row!)" : block);
  if (block === null) {
    advice.push("cordis.patch.yml is missing or corrupt — reinstall the plugin package.");
  }

  lines.push("");
  lines.push(`declared in package.json: ${manifest?.name ?? "?"}@${manifest?.version ?? "?"}`);
  lines.push("");
  if (advice.length === 0) {
    lines.push("verdict        : configuration looks complete; if a call still fails, read the error text of that call.");
  } else {
    lines.push("verdict        : action required");
    for (const item of advice) lines.push(`  - ${item}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * plugin entry
 * ------------------------------------------------------------------ */

/** A logger that cannot throw. */
function makeLogger(ctx) {
  let sink = null;
  try {
    const candidate = ctx?.logger;
    sink = typeof candidate === "function" ? candidate(PACKAGE_ID) : candidate ?? null;
  } catch {
    sink = null;
  }
  return (message) => {
    try {
      if (sink !== null && typeof sink.warn === "function") sink.warn(`[${PACKAGE_ID}] ${message}`);
      else if (sink !== null && typeof sink.info === "function") sink.info(`[${PACKAGE_ID}] ${message}`);
      else console.warn(`[${PACKAGE_ID}] ${message}`);
    } catch {
      /* logging must never break the boot */
    }
  };
}

/**
 * Startup audit: log exactly one warning when the bridge cannot possibly work,
 * stay silent otherwise.
 */
function auditStartup(warn) {
  if (!existsSync(patchPath)) {
    warn(`cordis.patch.yml is missing from ${packageRoot} — no Windows-MCP row was mounted. Reinstall the package.`);
    return;
  }
  if (bridgeBlock() === null) {
    warn("cordis.patch.yml has no windows-mcp-bridge row — the profile mounted this plugin but no Windows-MCP server.");
    return;
  }
  if (which("uvx") === null && which("uv") === null) {
    warn("neither `uvx` nor `uv` is on the PATH seen by this DSH process, so the Settings → Desktop page cannot install Windows-MCP. Install uv, then retry the install.");
  }
}

/** Register the doctor tool; failures downgrade to one warning. */
function registerDoctor(ctx, warn) {
  if (typeof ctx?.inject !== "function") return;
  try {
    ctx.inject(["tools"], (scoped) => {
      try {
        if (typeof scoped?.tools?.register !== "function") return;
        const dispose = scoped.tools.register({
          name: TOOL_NAME,
          description:
            "Diagnose the Windows-MCP bridge bundled by dsh-windows-mcp: uv/uvx availability, the ~/.windows-mcp install, the effective bridge row, and which mcp__windows__* tools are registered. Use this when the Windows desktop tools are missing or failing.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          output: {
            schema: {
              type: "object",
              properties: { report: { type: "string" } },
              required: ["report"],
              additionalProperties: false,
            },
            render(_args, value) {
              const report = typeof value?.report === "string" ? value.report : JSON.stringify(value, null, 2);
              return [{ type: "text", text: report }];
            },
          },
          execute() {
            return { report: buildReport(scoped.tools) };
          },
        });
        try {
          if (typeof dispose === "function" && typeof scoped.on === "function") scoped.on("dispose", dispose);
        } catch {
          /* disposal is best-effort */
        }
      } catch (error) {
        warn(`could not register the ${TOOL_NAME} tool: ${String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject the tools service: ${String(error)}`);
  }
}

/**
 * Serve the client pill: `GET` reports the flag plus the number of bridged
 * tools, `POST {enabled}` updates and persists it. The route is registered on
 * the shared web server, so the page loads it from the same origin it was
 * served from.
 */
function registerStateRoute(ctx, warn) {
  if (typeof ctx?.inject !== "function") return;
  try {
    ctx.inject(["webServer"], (scoped) => {
      try {
        if (typeof scoped?.webServer?.register !== "function") return;

        const respond = (response, status, body) => {
          try {
            const payload = JSON.stringify(body);
            response.writeHead(status, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
              "content-length": Buffer.byteLength(payload),
            });
            response.end(payload);
          } catch {
            /* the socket may already be gone */
          }
        };

        /**
         * The signed browser-session cookie the Host's Connection service mints
         * during the launch-token exchange. Every GUI fetch carries it; `curl`,
         * a shell script, or another agent cannot produce it, which is what
         * keeps the Computer Use switch a human decision.
         * @returns `true`, `false`, or `null` when this deployment mounts no
         *   Connection service and the answer is not observable.
         */
        /** The Host's Connection service, wherever this composition exposes it. */
        const connectionService = () => {
          for (const scope of [scoped, ctx]) {
            try {
              if (typeof scope?.get === "function") {
                const found = scope.get("connection");
                if (found !== null && found !== undefined) return found;
              }
            } catch {
              /* a context without that service is a normal composition */
            }
          }
          return null;
        };

        /** Whether the cookie gate can be enforced here, for the doctor and the page. */
        const gateState = () => {
          const found = connectionService();
          const auth = found === null ? null : found.browserAuth;
          const enforced = auth !== null && auth !== undefined && typeof auth.isAuthenticated === "function";
          return { cookie: enforced ? "enforced" : "unobservable" };
        };

        const browserSession = (request) => {
          const connection = connectionService();
          const auth = connection === null || connection === undefined ? null : connection.browserAuth;
          if (auth === null || auth === undefined || typeof auth.isAuthenticated !== "function") return null;
          let secure = false;
          try {
            secure = scoped.get("webServer")?.protocol === "https:";
          } catch {
            secure = false;
          }
          try {
            return auth.isAuthenticated(request, secure) === true;
          } catch {
            return false;
          }
        };

        /**
         * Refuse a mutation that did not come from the GUI window. Reads stay
         * open; every POST that changes the flag, the patch layer, the settings
         * or the toolchain has to prove it speaks for the browser session.
         */
        const guarded = (handler) => (request, response) => {
          if (request.method === "POST" && browserSession(request) === false) {
            respond(response, 401, {
              error: "this change has to come from the DSH window",
              hint: "The request carried no signed session cookie. Use the composer switch or the Settings page: a script, or a model with shell access, cannot turn desktop control on for itself.",
            });
            return;
          }
          handler(request, response);
        };

        /** Map the version manager's install progress onto the prepare shape the page polls. */
        const prepareSnapshot = () => {
          if (updater === null) return null;
          const install = updater.view().install;
          return {
            phase: install.phase === "installing" ? "running" : install.phase,
            startedAt: install.startedAt,
            finishedAt: install.finishedAt,
            error: install.error,
            log: install.log,
            bridge: install.bridge,
            version: install.version,
            mirror: install.mirror,
          };
        };

        /**
         * Settings plus what the profile patch actually says: the two only
         * match after a restart, because the MCP client reads its row at boot.
         */
        const settingsView = () => {
          const current = settings === null ? normalizeSettings(null).settings : settings;
          const patchText = readText(patchPath);
          const applied = bridgeSettingsMatch(current, patchText);
          return {
            settings: current,
            bridge: readBridgeSettings(patchText),
            applied,
            restartRequired: !applied,
            pluginVersion: selfVersion(),
          };
        };

        const snapshot = () => {
          const legacy = dependencySnapshot(which, windowsMcpVersionPin(readText(patchPath)));
          const update = updater === null ? null : updater.view();
          return {
            enabled: computerUse.enabled,
            bridged: bridgedToolCount(scoped.get?.("tools")),
            serverName: "windows",
            dependency: updater === null ? legacy : updater.dependencyView(legacy),
            prepare: prepareSnapshot(),
            update,
            settings: settingsView(),
            // `enforced` means a cookie-less POST is refused; `unobservable`
            // means this composition mounts no Connection service, so the
            // routes fall back to loopback reachability.
            gate: gateState(),
          };
        };

        const handler = (request, response) => {
          if (request.method === "GET") {
            respond(response, 200, snapshot());
            return;
          }
          if (request.method !== "POST") {
            respond(response, 405, { error: "method not allowed" });
            return;
          }
          const chunks = [];
          let size = 0;
          request.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_STATE_BODY_BYTES) {
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          request.on("end", () => {
            let next;
            try {
              next = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              respond(response, 400, { error: "invalid JSON body" });
              return;
            }
            if (typeof next?.enabled !== "boolean") {
              respond(response, 400, { error: "expected { enabled: boolean }" });
              return;
            }
            computerUse.enabled = next.enabled;
            persistComputerUse(computerUse.enabled);
            respond(response, 200, snapshot());
          });
          request.on("error", () => respond(response, 400, { error: "request failed" }));
        };

        /** Start installing the pinned (or newest known) Windows-MCP into its own tool root. */
        const prepareHandler = (request, response) => {
          if (request.method === "GET") {
            respond(response, 200, snapshot());
            return;
          }
          if (request.method !== "POST") {
            respond(response, 405, { error: "method not allowed" });
            return;
          }
          if (updater === null) {
            respond(response, 503, { error: "the version manager is not ready" });
            return;
          }
          const view = updater.view();
          const target = view.versions.pinned ?? view.check.latest;
          if (target === null) {
            respond(response, 409, { started: false, reason: "no Windows-MCP version is known yet", prepare: prepareSnapshot() });
            return;
          }
          if (view.install.phase === "installing") {
            respond(response, 409, { started: false, reason: "an install is already running", prepare: prepareSnapshot() });
            return;
          }
          void updater.installVersion(target);
          respond(response, 202, { started: true, spec: `windows-mcp@${target}`, prepare: prepareSnapshot() });
        };

        /** Stop a running install. */
        const cancelHandler = (request, response) => {
          if (request.method !== "POST") {
            respond(response, 405, { error: "method not allowed" });
            return;
          }
          const result = updater === null ? { cancelled: false } : updater.cancel();
          respond(response, 200, { cancelled: result.cancelled === true, prepare: prepareSnapshot() });
        };

        /** Point the bridge at the active executable (managed install first). */
        const bridgeHandler = (request, response) => {
          if (request.method !== "POST") {
            respond(response, 405, { error: "method not allowed" });
            return;
          }
          const view = updater === null ? null : updater.view();
          const executable = view?.versions?.activeExecutable ?? windowsMcpExecutable();
          if (executable === null) {
            respond(response, 409, {
              ok: false,
              error: "Windows-MCP is not installed yet, so there is nothing to point the bridge at.",
            });
            return;
          }
          respond(response, 200, writeBridgeOverride(executable, { warn, version: selfVersion() }));
        };

        /** Check for, install, activate and roll back Windows-MCP versions. */
        const updateHandler = (request, response) => {
          if (request.method === "GET") {
            respond(response, 200, updater === null ? { error: "the version manager is not ready" } : updater.view());
            return;
          }
          if (request.method !== "POST") {
            respond(response, 405, { error: "method not allowed" });
            return;
          }
          if (updater === null) {
            respond(response, 503, { error: "the version manager is not ready" });
            return;
          }
          const chunks = [];
          let size = 0;
          request.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_STATE_BODY_BYTES) {
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          request.on("end", () => {
            let body;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            } catch {
              respond(response, 400, { error: "invalid JSON body" });
              return;
            }
            const action = typeof body?.action === "string" ? body.action : "";
            const version = typeof body?.version === "string" && body.version !== "" ? body.version : null;
            const allowed = [...UPDATE_ACTIONS, "cancel"];
            if (!allowed.includes(action)) {
              respond(response, 400, { error: `expected { action } in ${allowed.join(", ")}` });
              return;
            }
            if (action === "check") {
              void updater.check({ force: true });
              respond(response, 202, { started: true, action });
              return;
            }
            if (action === "install") {
              const view = updater.view();
              const target = version ?? view.check.latest ?? view.versions.pinned;
              if (target === null) {
                respond(response, 409, { ok: false, error: "no Windows-MCP version is known yet — check for updates first" });
                return;
              }
              void updater.installVersion(target);
              respond(response, 202, { started: true, action, version: target });
              return;
            }
            if (action === "cancel") {
              respond(response, 200, updater.cancel());
              return;
            }
            if (action === "activate") {
              if (version === null) {
                respond(response, 400, { error: "activate needs { version }" });
                return;
              }
              respond(response, 200, updater.activateInstalled(version));
              return;
            }
            respond(response, 200, updater.rollback());
          });
          request.on("error", () => respond(response, 400, { error: "request failed" }));
        };

        /**
         * Read and update the user settings. Plugin settings apply at once;
         * bridge settings are written into the profile patch row and only take
         * effect after DSH restarts.
         */
        const settingsHandler = (request, response) => {
          if (request.method === "GET") {
            respond(response, 200, settingsView());
            return;
          }
          if (request.method !== "POST") {
            respond(response, 405, { error: "method not allowed" });
            return;
          }
          const chunks = [];
          let size = 0;
          request.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_SETTINGS_BODY_BYTES) {
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          request.on("end", () => {
            let body;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            } catch {
              respond(response, 400, { error: "invalid JSON body" });
              return;
            }
            const incoming = body !== null && typeof body === "object" && body.settings !== null && typeof body.settings === "object" ? body.settings : body;
            const normalized = normalizeSettings(incoming);
            const stored = writeSettings(normalized.settings, stateDirectory);
            settings = stored.settings;
            const wanted = bridgeSettingsOf(settings);
            if (bridgeSettingsMatch(settings, readText(patchPath))) {
              respond(response, 200, {
                ok: true,
                saved: stored.written,
                problems: normalized.problems,
                write: null,
                ...settingsView(),
              });
              return;
            }
            const view = updater === null ? null : updater.view();
            const executable = view?.versions?.activeExecutable ?? windowsMcpExecutable();
            if (executable === null) {
              respond(response, 200, {
                ok: true,
                saved: stored.written,
                problems: normalized.problems,
                write: { ok: false, error: "Windows-MCP is not installed yet, so the bridge row was left untouched" },
                ...settingsView(),
              });
              return;
            }
            const written = writeBridgeOverride(executable, { warn, version: selfVersion(), settings: wanted });
            respond(response, 200, {
              ok: written.ok === true,
              saved: stored.written,
              problems: normalized.problems,
              write: written,
              ...settingsView(),
            });
          });
          request.on("error", () => respond(response, 400, { error: "request failed" }));
        };

        // Every mutation is gated on the GUI's signed session cookie: the
        // Host's launch token is the only way to obtain one, so desktop
        // control cannot be switched on by a script or by another agent.
        scoped.webServer.register({ kind: "exact", path: STATE_ROUTE, handler: guarded(handler) });
        scoped.webServer.register({ kind: "exact", path: PREPARE_ROUTE, handler: guarded(prepareHandler) });
        scoped.webServer.register({ kind: "exact", path: PREPARE_CANCEL_ROUTE, handler: guarded(cancelHandler) });
        scoped.webServer.register({ kind: "exact", path: BRIDGE_ROUTE, handler: guarded(bridgeHandler) });
        scoped.webServer.register({ kind: "exact", path: UPDATE_ROUTE, handler: guarded(updateHandler) });
        scoped.webServer.register({ kind: "exact", path: SETTINGS_ROUTE, handler: guarded(settingsHandler) });
      } catch (error) {
        warn(`could not register the Computer Use state route: ${String(error)}`);
      }
    });
  } catch (error) {
    warn(`could not inject the web server: ${String(error)}`);
  }
}

/**
 * Plugin entry point. Never throws.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  try {
    const warn = makeLogger(ctx);
    computerUse.enabled = readComputerUse().enabled;
    settings = readSettings(stateDirectory);
    updater = createUpdater({
      warn,
      resolver: which,
      pinned: windowsMcpVersionPin(readText(patchPath)),
      preferredMirror: () => (settings === null ? "auto" : settings.plugin.preferredMirror),
      writeBridge: (executable) =>
        writeBridgeOverride(executable, {
          warn,
          version: selfVersion(),
          settings: settings === null ? null : bridgeSettingsOf(settings),
        }),
    });
    auditStartup(warn);
    registerDoctor(ctx, warn);
    registerStateRoute(ctx, warn);
    registerToolGate(ctx, warn);
    // Check for a newer Windows-MCP build in the background (cheap: a ranged
    // read per mirror, cached for hours). The page shows the result; the boot
    // never waits for it, and a failure only costs the last known answer. The
    // settings page can turn this off.
    if (settings === null || settings.plugin.autoCheckUpdates === true) {
      try {
        void updater.check({ force: false }).catch(() => {});
      } catch {
        /* a failed check is not a boot problem */
      }
    }
  } catch {
    /* apply() must not throw, whatever happens */
  }
}

export default { name: PACKAGE_ID, apply };
