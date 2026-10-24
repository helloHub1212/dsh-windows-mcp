/**
 * dsh-windows-mcp — managed installs (host side).
 *
 * Every Windows-MCP version this plugin installs lives in its own `uv` tool
 * root:
 *
 *   <home>/dsh-windows-mcp/toolchain/<version>/        ← UV_TOOL_DIR
 *   <home>/dsh-windows-mcp/toolchain/<version>/windows-mcp/Scripts/windows-mcp.exe
 *   <home>/dsh-windows-mcp/toolchain/<version>/manifest.json
 *
 * Isolating by version is what makes "update" safe: the previous environment is
 * never overwritten, so rolling back is a pointer move plus a bridge rewrite —
 * no download, no reinstall. `<home>/dsh-windows-mcp.versions.json` remembers
 * which version is active, which one it replaced, and what the last update
 * check saw.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dshHome, toolVersionIn } from "./dependency.js";

const VERSION_PATTERN = /^\d[0-9A-Za-z.+_-]*$/u;
const STATE_VERSION = 1;

/** Root that holds one tool root per Windows-MCP version. */
export function managedToolchainRoot(home = dshHome()) {
  return join(home, "dsh-windows-mcp", "toolchain");
}

/** `…/<version>` — the directory handed to `UV_TOOL_DIR`. */
export function versionToolRoot(root, version) {
  if (typeof root !== "string" || root === "") throw new TypeError("root must be a non-empty string");
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) throw new TypeError(`invalid Windows-MCP version: ${String(version)}`);
  return join(root, version);
}

/** `…/<version>/windows-mcp` — the tool environment inside the version root. */
export function toolDirectoryFor(root, version) {
  return join(versionToolRoot(root, version), "windows-mcp");
}

/** Executable path for a tool directory, or null when the tool is not there. */
export function executableIn(toolDirectory) {
  if (typeof toolDirectory !== "string" || toolDirectory === "") return null;
  for (const candidate of [join(toolDirectory, "Scripts", "windows-mcp.exe"), join(toolDirectory, "bin", "windows-mcp")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Executable of a managed version, or null when it is not installed. */
export function managedExecutable(root, version) {
  return executableIn(toolDirectoryFor(root, version));
}

/** `…/<version>/manifest.json` */
export function manifestPath(root, version) {
  return join(versionToolRoot(root, version), "manifest.json");
}

/** Read the install manifest of one managed version (null when absent). */
export function readManifest(root, version) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(root, version), "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the install manifest of one managed version. */
export function writeManifest(root, version, payload = {}) {
  const target = manifestPath(root, version);
  mkdirSync(versionToolRoot(root, version), { recursive: true });
  const manifest = {
    version,
    installedAt: new Date().toISOString(),
    executable: managedExecutable(root, version),
    ...payload,
  };
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Every managed version, newest first. */
export function listManagedVersions(root = managedToolchainRoot()) {
  let names = [];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && VERSION_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const versions = names.map((version) => {
    const toolDirectory = toolDirectoryFor(root, version);
    const manifest = readManifest(root, version);
    const executable = executableIn(toolDirectory);
    return {
      version,
      toolDirectory,
      executable,
      installedVersion: toolVersionIn(toolDirectory),
      manifest,
      installedAt: typeof manifest?.installedAt === "string" ? manifest.installedAt : null,
      mirror: typeof manifest?.mirror === "string" ? manifest.mirror : null,
      ready: executable !== null,
    };
  });
  return versions
    .filter((entry) => entry.ready)
    .sort((left, right) => compareVersionsDescending(left.version, right.version));
}

/** Local sort helper — newest first, numeric segments. */
function compareVersionsDescending(left, right) {
  const leftParts = left.split(/[.+-]/u).map((part) => (/^\d+$/u.test(part) ? Number(part) : part));
  const rightParts = right.split(/[.+-]/u).map((part) => (/^\d+$/u.test(part) ? Number(part) : part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") return rightPart - leftPart;
    return String(rightPart).localeCompare(String(leftPart));
  }
  return 0;
}

/** `<home>/dsh-windows-mcp.versions.json` */
export function versionsStatePath(home = dshHome()) {
  return join(home, "dsh-windows-mcp.versions.json");
}

/** A fresh, empty versions state. */
export function emptyVersionsState() {
  return { version: STATE_VERSION, active: null, previous: null, history: [], lastCheck: null };
}

/** Normalise anything read from disk into a usable state object. */
function normalizeVersionsState(parsed) {
  const state = emptyVersionsState();
  if (parsed === null || typeof parsed !== "object") return state;
  const version = (value) => (typeof value === "string" && VERSION_PATTERN.test(value) ? value : null);
  state.active = version(parsed.active);
  state.previous = version(parsed.previous);
  if (Array.isArray(parsed.history)) {
    state.history = parsed.history
      .filter((entry) => entry !== null && typeof entry === "object" && version(entry.version) !== null)
      .slice(-20)
      .map((entry) => ({ version: version(entry.version), activatedAt: typeof entry.activatedAt === "string" ? entry.activatedAt : null }));
  }
  if (parsed.lastCheck !== null && typeof parsed.lastCheck === "object" && typeof parsed.lastCheck.at === "string") {
    state.lastCheck = {
      at: parsed.lastCheck.at,
      latest: version(parsed.lastCheck.latest),
      best: typeof parsed.lastCheck.best === "string" ? parsed.lastCheck.best : null,
      mirrors: Array.isArray(parsed.lastCheck.mirrors) ? parsed.lastCheck.mirrors : [],
    };
  }
  return state;
}

/** Read the versions state, tolerating a missing or damaged file. */
export function readVersionsState(home = dshHome()) {
  try {
    return normalizeVersionsState(JSON.parse(readFileSync(versionsStatePath(home), "utf8")));
  } catch {
    return emptyVersionsState();
  }
}

/** Write the versions state atomically (write-then-rename). */
export function writeVersionsState(state, home = dshHome()) {
  const target = versionsStatePath(home);
  const temporary = `${target}.tmp`;
  const payload = { ...emptyVersionsState(), ...state, version: STATE_VERSION, history: state.history?.slice(-20) ?? [] };
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, target);
  return payload;
}

/** Record `version` as active and the previous active as its rollback target. */
export function activateVersion(state, version) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) throw new TypeError(`invalid Windows-MCP version: ${String(version)}`);
  const previous = state.active !== null && state.active !== version ? state.active : null;
  const history = [...(state.history ?? []), { version, activatedAt: new Date().toISOString() }].slice(-20);
  return { ...state, active: version, previous, history };
}

/** Where the bridge should point: the active managed version's executable. */
export function activeInstall(state, home = dshHome()) {
  const version = state?.active ?? null;
  if (version === null) return null;
  const executable = managedExecutable(managedToolchainRoot(home), version);
  if (executable === null) return null;
  return { version, executable, toolDirectory: toolDirectoryFor(managedToolchainRoot(home), version) };
}
