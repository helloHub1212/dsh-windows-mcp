/**
 * dsh-windows-mcp — user-adjustable settings (host side).
 *
 * The plugin's settings page (Settings → left rail) writes this file. There are
 * two families, and they differ in when they take effect:
 *
 *   - `bridge` values are baked into the machine-written row in the profile
 *     patch, so they only take effect after DSH restarts — the MCP client reads
 *     that row once, at boot.
 *   - `plugin` values belong to this plugin itself and apply immediately.
 *
 * Everything is validated and clamped before it is stored or rendered: a
 * hand-edited, truncated or future-version file must never break the host, and
 * a bad value must never produce a patch row the client cannot parse.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BRIDGE_DEFAULTS, PROFILE_BLOCK_BEGIN, PROFILE_BLOCK_END } from "./dependency.js";
import { MIRROR_CANDIDATES } from "./mirrors.js";

export const SETTINGS_ROUTE = "/dsh-windows-mcp/settings";
export const SETTINGS_VERSION = 1;
export const SETTINGS_FILE = "dsh-windows-mcp.settings.json";

/** Screenshot downscales the upstream server accepts. */
export const SCREENSHOT_SCALES = Object.freeze([0.25, 0.5, 0.75, 1]);
/** Upstream capture backends, `auto` lets the server pick. */
export const SCREENSHOT_BACKENDS = Object.freeze(["auto", "dxcam", "mss", "pillow"]);
/** Tools whose registration costs the most context; all on by default. */
export const EXCLUDABLE_TOOLS = Object.freeze(["App", "PowerShell", "FileSystem"]);
/** `auto` means "whatever the speed probe ranks first". */
export const MIRROR_CHOICES = Object.freeze(["auto"].concat(MIRROR_CANDIDATES.map((mirror) => mirror.id)));
/** `toolCallTimeoutMs` bounds — generous, but not unbounded. */
export const TIMEOUT_RANGE = Object.freeze({ min: 5000, max: 600000 });

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  bridge: Object.freeze({
    toolCallTimeoutMs: BRIDGE_DEFAULTS.toolCallTimeoutMs,
    excludeTools: Object.freeze(BRIDGE_DEFAULTS.excludeTools.slice()),
    screenshotScale: BRIDGE_DEFAULTS.screenshotScale,
    screenshotBackend: BRIDGE_DEFAULTS.screenshotBackend,
    disableFlash: BRIDGE_DEFAULTS.disableFlash,
  }),
  plugin: Object.freeze({
    autoCheckUpdates: true,
    preferredMirror: "auto",
  }),
});

/** DSH home: `$DSH_HOME`, else `~/.dsh`. */
export function dshHome(env = process.env) {
  const fromEnvironment = String(env?.DSH_HOME ?? "").trim();
  return fromEnvironment === "" ? join(homedir(), ".dsh") : fromEnvironment;
}

/** Where the settings file lives for a DSH home. */
export function settingsPath(home = dshHome()) {
  return join(home, SETTINGS_FILE);
}

/** A mutable copy of the defaults. */
export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    bridge: {
      toolCallTimeoutMs: DEFAULT_SETTINGS.bridge.toolCallTimeoutMs,
      excludeTools: DEFAULT_SETTINGS.bridge.excludeTools.slice(),
      screenshotScale: DEFAULT_SETTINGS.bridge.screenshotScale,
      screenshotBackend: DEFAULT_SETTINGS.bridge.screenshotBackend,
      disableFlash: DEFAULT_SETTINGS.bridge.disableFlash,
    },
    plugin: {
      autoCheckUpdates: DEFAULT_SETTINGS.plugin.autoCheckUpdates,
      preferredMirror: DEFAULT_SETTINGS.plugin.preferredMirror,
    },
  };
}

/**
 * Coerce anything into a complete, valid settings object.
 * @returns `{ settings, problems }` — `problems` names every value that was
 *   replaced by its default, so the page can say what it ignored.
 */
export function normalizeSettings(input) {
  const settings = defaultSettings();
  const problems = [];
  if (input === null || typeof input !== "object") return { settings, problems };
  const bridge = input.bridge !== null && typeof input.bridge === "object" ? input.bridge : {};
  const plugin = input.plugin !== null && typeof input.plugin === "object" ? input.plugin : {};

  const timeout = Number(bridge.toolCallTimeoutMs);
  if (Number.isFinite(timeout) && timeout >= TIMEOUT_RANGE.min && timeout <= TIMEOUT_RANGE.max) {
    settings.bridge.toolCallTimeoutMs = Math.round(timeout);
  } else if (bridge.toolCallTimeoutMs !== undefined) {
    problems.push("bridge.toolCallTimeoutMs");
  }

  if (Array.isArray(bridge.excludeTools)) {
    const wanted = [];
    for (const value of bridge.excludeTools) {
      const name = typeof value === "string" ? value.trim() : "";
      if (EXCLUDABLE_TOOLS.includes(name) && !wanted.includes(name)) wanted.push(name);
    }
    const ignored = bridge.excludeTools.length - wanted.length;
    if (ignored > 0) problems.push("bridge.excludeTools");
    settings.bridge.excludeTools = wanted;
  } else if (bridge.excludeTools !== undefined) {
    problems.push("bridge.excludeTools");
  }

  const scale = Number(bridge.screenshotScale);
  if (SCREENSHOT_SCALES.includes(scale)) settings.bridge.screenshotScale = scale;
  else if (bridge.screenshotScale !== undefined) problems.push("bridge.screenshotScale");

  if (SCREENSHOT_BACKENDS.includes(bridge.screenshotBackend)) settings.bridge.screenshotBackend = bridge.screenshotBackend;
  else if (bridge.screenshotBackend !== undefined) problems.push("bridge.screenshotBackend");

  if (typeof bridge.disableFlash === "boolean") settings.bridge.disableFlash = bridge.disableFlash;
  else if (bridge.disableFlash !== undefined) problems.push("bridge.disableFlash");

  if (typeof plugin.autoCheckUpdates === "boolean") settings.plugin.autoCheckUpdates = plugin.autoCheckUpdates;
  else if (plugin.autoCheckUpdates !== undefined) problems.push("plugin.autoCheckUpdates");

  if (MIRROR_CHOICES.includes(plugin.preferredMirror)) settings.plugin.preferredMirror = plugin.preferredMirror;
  else if (plugin.preferredMirror !== undefined) problems.push("plugin.preferredMirror");

  return { settings, problems };
}

/** Read the stored settings; a missing or corrupt file means "defaults". */
export function readSettings(home = dshHome()) {
  try {
    const text = readFileSync(settingsPath(home), "utf8");
    return normalizeSettings(JSON.parse(text)).settings;
  } catch {
    return defaultSettings();
  }
}

/** Validate, store (atomically) and return the settings that were kept. */
export function writeSettings(input, home = dshHome()) {
  const { settings } = normalizeSettings(input);
  const file = settingsPath(home);
  const payload = `${JSON.stringify(settings, null, 2)}\n`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, payload, "utf8");
    renameSync(temporary, file);
  } catch (error) {
    return { settings, written: false, error: String(error), path: file };
  }
  return { settings, written: true, error: null, path: file };
}

/** The five values that end up in the bridge row. */
export function bridgeSettingsOf(settings) {
  const source = settings !== null && typeof settings === "object" && settings.bridge !== null && typeof settings.bridge === "object" ? settings.bridge : DEFAULT_SETTINGS.bridge;
  return {
    toolCallTimeoutMs: typeof source.toolCallTimeoutMs === "number" ? source.toolCallTimeoutMs : DEFAULT_SETTINGS.bridge.toolCallTimeoutMs,
    excludeTools: Array.isArray(source.excludeTools) ? source.excludeTools.slice() : DEFAULT_SETTINGS.bridge.excludeTools.slice(),
    screenshotScale: typeof source.screenshotScale === "number" ? source.screenshotScale : DEFAULT_SETTINGS.bridge.screenshotScale,
    screenshotBackend: typeof source.screenshotBackend === "string" ? source.screenshotBackend : DEFAULT_SETTINGS.bridge.screenshotBackend,
    disableFlash: typeof source.disableFlash === "boolean" ? source.disableFlash : DEFAULT_SETTINGS.bridge.disableFlash,
  };
}

/** Split the YAML flow sequence in `args: [...]`, keeping quoted commas intact. */
function splitFlowList(raw) {
  const parts = [];
  let current = "";
  let quoted = false;
  for (const character of String(raw)) {
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts.map((part) => part.replace(/^["']|["']$/gu, "").trim()).filter((part) => part !== "");
}

/**
 * Read the bridge values back out of a profile patch layer.
 * @returns `{ toolCallTimeoutMs, excludeTools, screenshotScale,
 *   screenshotBackend, disableFlash }` — missing fields stay `undefined`.
 */
export function readBridgeSettings(patchText) {
  const text = String(patchText ?? "");
  const begin = text.indexOf(PROFILE_BLOCK_BEGIN);
  const end = text.indexOf(PROFILE_BLOCK_END);
  const block = begin === -1 || end === -1 || end < begin ? "" : text.slice(begin, end);
  const found = {
    toolCallTimeoutMs: undefined,
    excludeTools: undefined,
    screenshotScale: undefined,
    screenshotBackend: undefined,
    disableFlash: undefined,
  };

  const timeout = /(?:^|\n)\s*toolCallTimeoutMs:\s*(\d+)/u.exec(block);
  if (timeout !== null) found.toolCallTimeoutMs = Number(timeout[1]);

  const args = /(?:^|\n)\s*args:\s*\[([^\]]*)\]/u.exec(block);
  if (args !== null) {
    const tokens = splitFlowList(args[1]);
    const index = tokens.indexOf("--exclude-tools");
    if (index === -1) found.excludeTools = [];
    else if (index + 1 < tokens.length) found.excludeTools = tokens[index + 1].split(",").map((name) => name.trim()).filter((name) => name !== "");
  }

  const scale = /WINDOWS_MCP_SCREENSHOT_SCALE:\s*"([0-9.]+)"/u.exec(block);
  if (scale !== null) found.screenshotScale = Number(scale[1]);

  const backend = /WINDOWS_MCP_SCREENSHOT_BACKEND:\s*"([a-z]+)"/u.exec(block);
  if (backend !== null) found.screenshotBackend = backend[1];

  const flash = /WINDOWS_MCP_DISABLE_FLASH:\s*"([01])"/u.exec(block);
  if (flash !== null) found.disableFlash = flash[1] === "1";
  else if (block !== "") found.disableFlash = false;

  return found;
}

/**
 * Do the stored settings already match the bridge row in `patchText`? A field the
 * row does not declare falls back to this package's shipped default, so a patch
 * layer without a machine-written block still compares equal to the defaults.
 */
export function bridgeSettingsMatch(settings, patchText) {
  const wanted = bridgeSettingsOf(settings);
  const found = readBridgeSettings(patchText);
  const actual = {
    toolCallTimeoutMs: found.toolCallTimeoutMs === undefined ? BRIDGE_DEFAULTS.toolCallTimeoutMs : found.toolCallTimeoutMs,
    excludeTools: found.excludeTools === undefined ? BRIDGE_DEFAULTS.excludeTools.slice() : found.excludeTools,
    screenshotScale: found.screenshotScale === undefined ? BRIDGE_DEFAULTS.screenshotScale : found.screenshotScale,
    screenshotBackend: found.screenshotBackend === undefined ? BRIDGE_DEFAULTS.screenshotBackend : found.screenshotBackend,
    disableFlash: found.disableFlash === undefined ? BRIDGE_DEFAULTS.disableFlash : found.disableFlash,
  };
  if (actual.toolCallTimeoutMs !== wanted.toolCallTimeoutMs) return false;
  if (actual.screenshotScale !== wanted.screenshotScale) return false;
  if (actual.disableFlash !== wanted.disableFlash) return false;
  if (actual.screenshotBackend !== wanted.screenshotBackend) return false;
  if (actual.excludeTools.length !== wanted.excludeTools.length) return false;
  return wanted.excludeTools.every((name) => actual.excludeTools.includes(name));
}
